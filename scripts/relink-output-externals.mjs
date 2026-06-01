#!/usr/bin/env node
import {
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	statSync,
	symlinkSync,
} from "node:fs";
/**
 * Relink externalized dependencies into the Nitro production output.
 *
 * `pnpm build` produces `apps/web/.output/server`, but Nitro's dependency
 * tracing does not pull every externalized package into the output's
 * `node_modules` (native modules like bcrypt/sharp and a number of pure-JS
 * deps are left out). Because pnpm keeps transitive deps under
 * `node_modules/.pnpm` rather than the flat root, `node .output/server` then
 * fails with ERR_MODULE_NOT_FOUND at runtime.
 *
 * This script scans the built server for bare imports and symlinks each one
 * from the pnpm store into `.output/server/node_modules`, so the production
 * server starts without Docker. Run it after every `pnpm build` (the
 * `start:prod` script does this automatically).
 *
 * Packages it can't resolve are reported but not fatal — they are unused
 * optional drivers (mysql2/tedious/tarn/better-sqlite3 — Postgres is used) or
 * type-only packages (estree/hast/mdast/unist) that are never imported at run
 * time.
 */
import { builtinModules } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUTDIR = join(ROOT, "apps/web/.output/server");
const NM = join(OUTDIR, "node_modules");
const PNPM = join(ROOT, "node_modules/.pnpm");

if (!existsSync(OUTDIR)) {
	console.error(`[relink] ${OUTDIR} not found — run \`pnpm build\` first.`);
	process.exit(1);
}

const builtin = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);

function walk(dir) {
	let out = [];
	for (const entry of readdirSync(dir)) {
		if (entry === "node_modules") continue;
		const p = join(dir, entry);
		const s = statSync(p);
		if (s.isDirectory()) out = out.concat(walk(p));
		else if (/\.(mjs|js|cjs)$/.test(entry)) out.push(p);
	}
	return out;
}

// Collect bare specifiers from static imports/exports, dynamic import(), require().
const specRe =
	/(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g;
const pkgs = new Set();
for (const file of walk(OUTDIR)) {
	const src = readFileSync(file, "utf8");
	for (const m of src.matchAll(specRe)) {
		const spec = m[1] || m[2] || m[3];
		if (!spec || /^[./#]/.test(spec) || spec.startsWith("node:") || builtin.has(spec)) continue;
		// Skip template-literal fragments / non-static specifiers (e.g. `${url}`).
		if (/[${}`\s]/.test(spec)) continue;
		const parts = spec.split("/");
		pkgs.add(spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]);
	}
}

// Find a package's real directory in the pnpm store (or the flat root as fallback).
const pnpmEntries = existsSync(PNPM) ? readdirSync(PNPM) : [];
function resolvePkgDir(pkg) {
	const flat = join(ROOT, "node_modules", pkg);
	if (existsSync(flat)) {
		try {
			return realpathSync(flat);
		} catch {}
	}
	const prefix = `${pkg.replace("/", "+")}@`;
	for (const entry of pnpmEntries) {
		if (!entry.startsWith(prefix)) continue;
		const candidate = join(PNPM, entry, "node_modules", pkg);
		if (existsSync(candidate)) {
			try {
				return realpathSync(candidate);
			} catch {}
		}
	}
	return null;
}

mkdirSync(NM, { recursive: true });
let linked = 0;
let already = 0;
const missing = [];
for (const pkg of [...pkgs].sort()) {
	const dest = join(NM, pkg);
	try {
		if (lstatSync(dest)) {
			already++;
			continue;
		}
	} catch {}
	const src = resolvePkgDir(pkg);
	if (!src) {
		missing.push(pkg);
		continue;
	}
	if (pkg.startsWith("@")) mkdirSync(join(NM, pkg.split("/")[0]), { recursive: true });
	symlinkSync(src, dest);
	linked++;
}

console.log(`[relink] referenced=${pkgs.size} linked=${linked} present=${already} unresolved=${missing.length}`);
if (missing.length) console.log(`[relink] unresolved (expected: optional drivers / type-only): ${missing.join(", ")}`);
