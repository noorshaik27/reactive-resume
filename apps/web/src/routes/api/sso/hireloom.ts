/**
 * SSO bridge: accepts a Hireloom-signed handoff token and signs the user into
 * Reactive Resume by minting a Better Auth session via the public API.
 *
 * Flow:
 *   1. Hireloom (LiveInterview) builds a JWT-style payload `{email, name, exp,
 *      nonce}` and signs it with HMAC-SHA256 keyed on the shared
 *      HIRELOOM_SSO_SECRET. Redirects the browser to
 *      `/api/sso/hireloom?token=<payload>.<sig>&next=/dashboard`.
 *   2. We verify the signature in constant time, check exp (≤ 60s old), and
 *      derive a deterministic password from HMAC(SSO_SECRET, email). The
 *      password is internal — the user never sees or uses it directly.
 *   3. We call auth.api.signUpEmail (ignore "already exists"), then
 *      auth.api.signInEmail with asResponse=true. Better Auth handles all
 *      cookie signing + session DB writes natively.
 *   4. Mirror the Set-Cookie headers from Better Auth's response and 302 to
 *      `next` (defaulting to /dashboard).
 *
 * Security:
 *   - HMAC verified in constant time (timingSafeEqual)
 *   - exp clamped to ≤ 60s to make replay windows tiny
 *   - nonce included but not stored — the short TTL is the replay defence
 *   - email lower-cased + trimmed before any DB / Better Auth call
 *   - Only HIRELOOM_SSO_SECRET, not AUTH_SECRET, is used to validate the
 *     handoff, so a leaked SSO secret can't forge native sign-ins
 */

import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "node:crypto";
import { auth } from "@reactive-resume/auth/config";
import { toUsername } from "@reactive-resume/utils/string";

const MAX_TOKEN_AGE_MS = 60_000;
const DEFAULT_NEXT = "/dashboard/resumes";

function b64urlDecode(s: string): Buffer {
	const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
	return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function hmacB64Url(secret: string, data: string): string {
	return createHmac("sha256", secret).update(data).digest("base64url");
}

type Payload = { email: string; name?: string; exp: number; nonce: string };

function verifyAndParse(token: string, secret: string): Payload | null {
	const [body, sig] = token.split(".");
	if (!body || !sig) return null;
	const expected = hmacB64Url(secret, body);
	// Constant-time compare; bail if lengths mismatch
	if (expected.length !== sig.length) return null;
	if (!timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
	try {
		const payload = JSON.parse(b64urlDecode(body).toString("utf-8")) as Payload;
		if (!payload.email || typeof payload.email !== "string") return null;
		if (typeof payload.exp !== "number") return null;
		const now = Date.now();
		if (payload.exp < now) return null;
		if (payload.exp > now + MAX_TOKEN_AGE_MS) return null;
		return payload;
	} catch {
		return null;
	}
}

function derivedPassword(email: string, secret: string): string {
	// 64-char hex — comfortably satisfies any password policy. The derivation
	// is one-way so an attacker with neither secret nor email can't enumerate.
	return createHmac("sha256", secret).update(`pw:${email}`).digest("hex");
}

function sanitizeNext(raw: string | null): string {
	if (!raw) return DEFAULT_NEXT;
	// Only allow relative same-site paths — defends against open-redirect.
	if (!raw.startsWith("/") || raw.startsWith("//")) return DEFAULT_NEXT;
	if (raw.includes("\n") || raw.includes("\r")) return DEFAULT_NEXT;
	return raw;
}

async function handler({ request }: { request: Request }) {
	const url = new URL(request.url);
	const token = url.searchParams.get("token");
	const next = sanitizeNext(url.searchParams.get("next"));

	const ssoSecret = process.env.HIRELOOM_SSO_SECRET ?? "";
	if (!ssoSecret) {
		return new Response("SSO not configured: HIRELOOM_SSO_SECRET unset", { status: 500 });
	}
	if (!token) return new Response("Missing token", { status: 400 });

	const payload = verifyAndParse(token, ssoSecret);
	if (!payload) return new Response("Invalid or expired SSO token", { status: 401 });

	const email = payload.email.trim().toLowerCase();
	const name = (payload.name ?? email.split("@")[0]).slice(0, 80);
	const password = derivedPassword(email, ssoSecret);
	// Better Auth's username plugin requires `username` + `displayUsername` —
	// the schema enforces NOT NULL UNIQUE on both. Derive a deterministic
	// base from the email local-part and append a short hash for uniqueness
	// so two emails that share a local-part don't collide.
	const baseUsername = toUsername(email.split("@")[0] || "user");
	const suffix = createHmac("sha256", ssoSecret).update(email).digest("hex").slice(0, 6);
	const username = `${baseUsername}-${suffix}`.slice(0, 30);

	// Try sign-up (idempotent: if user exists this throws and we ignore it).
	try {
		await auth.api.signUpEmail({
			body: { email, password, name, username, displayUsername: username },
			asResponse: false,
		});
	} catch (e) {
		// Expected on every sign-in after the first. We only want to bail on
		// truly unexpected errors.
		const msg = e instanceof Error ? e.message.toLowerCase() : "";
		const benign = msg.includes("already") || msg.includes("exist") || msg.includes("duplicate");
		if (!benign) {
			console.error("[sso/hireloom] signUpEmail failed:", e);
		}
	}

	// Sign in to mint a session. asResponse=true returns a Response whose
	// Set-Cookie headers carry Better Auth's signed session cookie.
	let signInResponse: Response;
	try {
		signInResponse = (await auth.api.signInEmail({
			body: { email, password, rememberMe: true },
			asResponse: true,
		})) as Response;
	} catch (e) {
		console.error("[sso/hireloom] signInEmail failed:", e);
		return new Response("SSO sign-in failed", { status: 500 });
	}

	if (!signInResponse.ok) {
		// Most likely the user existed with a different password (e.g. signed
		// up directly via UI before we wired SSO). Surface that clearly.
		const body = await signInResponse.text().catch(() => "");
		console.warn("[sso/hireloom] sign-in non-2xx:", signInResponse.status, body);
		return new Response(
			"This email is registered with Reactive Resume directly. Sign in there once with your existing password, or reset it, before using SSO from Hireloom.",
			{ status: 409 },
		);
	}

	// Mirror Set-Cookie headers onto a 302 redirect.
	const headers = new Headers();
	for (const value of signInResponse.headers.getSetCookie?.() ?? []) {
		headers.append("Set-Cookie", value);
	}
	headers.set("Location", next);
	return new Response(null, { status: 302, headers });
}

export const Route = createFileRoute("/api/sso/hireloom")({
	server: {
		handlers: {
			GET: handler,
		},
	},
});
