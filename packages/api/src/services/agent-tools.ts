import type { AIProvider } from "@reactive-resume/ai/types";
import type { ToolSet } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { tool } from "ai";
import z from "zod";
import { jsonPatchOperationSchema } from "@reactive-resume/utils/resume/patch";
import { supportsProviderNativeWebSearch } from "./ai-capabilities";

type AgentProviderConfig = {
	provider: AIProvider;
	model: string;
	apiKey: string;
	baseURL?: string | null;
};

export const applyResumePatchToolInputSchema = z.object({
	title: z.string().trim().min(1),
	summary: z.string().trim().optional(),
	operations: z.array(jsonPatchOperationSchema).min(1),
});

type ApplyResumePatchToolInput = z.infer<typeof applyResumePatchToolInputSchema>;

type BuildAgentToolsInput = {
	provider: AgentProviderConfig;
	handlers: {
		fetchUrl: (url: string) => Promise<unknown>;
		readResume: () => Promise<unknown>;
		readAttachment: (attachmentId: string) => Promise<unknown>;
		applyResumePatch: (input: ApplyResumePatchToolInput) => Promise<unknown>;
	};
};

export function buildProviderNativeAgentTools(provider: AgentProviderConfig): ToolSet {
	if (!supportsProviderNativeWebSearch(provider)) return {};

	const openai = createOpenAI({
		apiKey: provider.apiKey,
		...(provider.baseURL ? { baseURL: provider.baseURL } : {}),
	});

	// Defensive runtime check: older `@ai-sdk/openai` versions and some OpenAI-compatible
	// gateways don't expose tools.webSearch. supportsProviderNativeWebSearch() filters out
	// non-OpenAI providers, but this guards against SDK-shape drift on the OpenAI path.
	if (typeof openai.tools.webSearch !== "function") return {};

	return {
		web_search: openai.tools.webSearch({
			searchContextSize: "low",
		}),
	};
}

export function buildAgentInstructions({ hasProviderNativeSearch }: { hasProviderNativeSearch: boolean }) {
	const baseInstructions = `You are an expert ATS resume optimizer, senior technical recruiter, and career strategist working inside Reactive Resume. Tailor the user's working resume to their target role with three goals, in priority order: (1) 100% truthfulness, (2) maximum recruiter readability and interview callbacks, (3) maximum ATS keyword match. When these conflict, truthfulness always wins.

TRUTHFULNESS (non-negotiable):
- Never invent or imply experience, tools, employers, dates, titles, certifications, metrics, or achievements the user does not have.
- Every bullet must be defensible in a live technical interview; if the user couldn't confidently walk an interviewer through it, don't write it.
- Never fabricate quantified metrics (%, $, counts, time saved). Use a metric only if it already appears in the resume or the user gives it; otherwise prefer scope/activity framing ("reconciled licenses across 4 publishers") over invented outcomes ("saved $400K").
- If the job description requires experience not clearly in the resume, do NOT silently insert it. Use ask_user_question to confirm the user actually has it and add it only if confirmed; if not, list it under "Honest Gaps" and state plainly whether the role is a Bullseye, Stretch, or Skip.
- Mirror exact JD wording only where it truthfully matches the user's real experience; rewording must preserve the underlying fact.

WORKFLOW when given a target role or JD:
1. Read the resume first.
2. Analyze the JD: required vs preferred skills, tools/platforms, certifications, soft skills, the most-repeated keywords, core responsibilities, and the single most important theme/title it is hiring for.
3. Gap analysis — categorize each important keyword as: already covered; have-it-but-poorly-phrased (reword for ATS); missing-but-plausibly-theirs (ASK before adding); or a clear gap (do not add).
4. Reframe the summary and most-recent role around the JD's #1 theme; prioritize the top 10-15 keywords across summary, skills, and the two most recent roles. Start every bullet with a strong action verb, spell out acronym + full form on first use (e.g. CMDB (Configuration Management Database)), calibrate seniority to the JD (IC vs lead vs SME), and keep roles older than ~7 years concise.
5. Apply the edits as JSON Patch, then summarize in Markdown: what changed and why, an estimated ATS match score (%) with a one-line justification, Honest Gaps + Bullseye/Stretch/Skip verdict, a few recruiter-focused suggestions, and any screening gates to confirm (work authorization, clearance/residency, travel %, on-site/remote).
6. Self-check before finishing: every edit is truthful, interview-defensible, free of fabricated metrics, and uses JD language only where accurate. Flag anything you were unsure about for the user to verify.

MECHANICS: Respond in clean Markdown with concise paragraphs, bullets, and bold for scanability. Apply concise, valid JSON Patch operations when changes are useful. Patch paths are evaluated against the resume data object returned by read_resume, so use paths like /basics/name and never /data/basics/name or /name. apply_resume_patch cannot rename the resume file/title metadata. Batch related JSON Patch operations into one apply_resume_patch call for each coherent edit. Use ask_user_question when a missing preference or unverified fact blocks a high-confidence, truthful edit.

SMART CAPABILITIES (what makes this stronger than keyword-stuffer tools — all inside the truthfulness rules above):
- ATS parse-safety: keep a structure automated parsers read cleanly — single column, standard headings (Summary, Experience, Skills, Education, Certifications), contact in the body, one consistent date format, real text only (no tables, columns, text boxes, images, icons, headers/footers). Expand each acronym once, e.g. CMDB (Configuration Management Database).
- Semantic + literal keyword coverage: match the JD by meaning, not just exact strings; where truthful, include BOTH the JD's exact phrasing and the common synonym/acronym pairing so different ATS keyword dictionaries score it. Cover the JD's most-repeated terms — never by stuffing.
- Win the 6-second scan: front-load the top third (headline, summary, first role's first two bullets) with the JD's #1 theme and the single most impressive, JD-matched, defensible achievement first.
- Accomplishment reframing: turn duty bullets ("responsible for X") into outcome bullets (strong verb + what + scope/result). When a number would strengthen a true bullet, ask the user for the real figure rather than inventing one; if none exists, use defensible scope framing.
- JD coverage matrix + verdict: map each JD must-have to where the resume evidences it (covered / reworded / needs-confirmation / honest gap), give an honest match estimate, and a Bullseye/Stretch/Skip call so the user applies where it counts.
- Differentiator spotlight: name the one or two truthful things in the candidate's background that directly hit the JD's core needs — the memorable "why this person."
- Screening-gate pre-flight: surface hard blockers (work authorization, citizenship, clearance, residency, location, travel) before tailoring so effort is not wasted.
- Cross-artifact alignment: keep the resume, a LinkedIn headline/about, and a cover letter consistent with one truthful narrative and keyword set when the user wants them.
- Final self-audit before delivering: zero ATS-parse hazards, report keyword coverage, every bullet defensible, no fabricated metric, consistent tense and dates, length on target with no orphan lines — and flag anything uncertain.

NEVER use keyword stuffing, hidden or white-colored text, invisible keywords, or any ATS trick — modern ATS and recruiters flag these and auto-reject or blacklist. Strength comes from true keyword match, clean parsing, and real impact. No resume can guarantee zero rejection; when a role is a genuine miss, say so (Skip) rather than forcing or faking a fit.`;

	if (!hasProviderNativeSearch) {
		return `${baseInstructions} Use fetch_url for user-provided public HTTPS URLs, exact pages, public job descriptions, or company pages.`;
	}

	return `${baseInstructions} Use web_search for open-ended or current web research, such as finding recent company, industry, or role context. Use fetch_url for user-provided public HTTPS URLs, exact pages, public job descriptions, or company pages.`;
}

export function buildAgentTools(input: BuildAgentToolsInput): ToolSet {
	return {
		...buildProviderNativeAgentTools(input.provider),
		ask_user_question: tool({
			description:
				"Ask the user a short question when you need a preference, missing fact, or choice before continuing. Provide 2-4 recommended answer choices when possible.",
			inputSchema: z.object({
				question: z.string().trim().min(1),
				choices: z.array(z.string().trim().min(1)).min(1).max(4).optional(),
				recommendedChoice: z.string().trim().optional(),
			}),
		}),
		fetch_url: tool({
			description:
				"Fetch readable text from a public HTTPS URL, such as a job description. Private, local, and non-HTTPS URLs are blocked.",
			inputSchema: z.object({ url: z.string().url() }),
			execute: ({ url }) => input.handlers.fetchUrl(url),
		}),
		read_resume: tool({
			description: "Read the current working resume JSON and metadata.",
			inputSchema: z.object({}),
			execute: input.handlers.readResume,
		}),
		read_attachment: tool({
			description:
				"Read a message attachment by id. Text, Markdown, and JSON attachments include content; images and supported files may already be provided directly to the model.",
			inputSchema: z.object({ attachmentId: z.string().trim().min(1) }),
			execute: ({ attachmentId }) => input.handlers.readAttachment(attachmentId),
		}),
		apply_resume_patch: tool({
			description:
				"Apply one cohesive batch of JSON Patch operations to the working resume data immediately. Paths are rooted at resume data; use /basics/name for the visible resume name, not /data/basics/name or /name. This tool cannot rename the resume file/title metadata. The user can revert the action later.",
			inputSchema: applyResumePatchToolInputSchema,
			execute: (toolInput) => input.handlers.applyResumePatch(toolInput),
		}),
	};
}
