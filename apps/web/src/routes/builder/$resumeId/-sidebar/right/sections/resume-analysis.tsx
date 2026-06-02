import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { ArrowRightIcon, InfoIcon, LightningIcon, SparkleIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import { match } from "ts-pattern";
import { Alert, AlertDescription } from "@reactive-resume/ui/components/alert";
import { Badge } from "@reactive-resume/ui/components/badge";
import { Button } from "@reactive-resume/ui/components/button";
import { useResume } from "@/components/resume/builder-resume-draft";
import { getOrpcErrorMessage } from "@/libs/error-message";
import { orpc } from "@/libs/orpc/client";
import { SectionBase } from "../shared/section-base";

function impactCircleClass(impact: "high" | "medium" | "low") {
	return match(impact)
		.with("high", () => "bg-rose-600")
		.with("medium", () => "bg-amber-600")
		.with("low", () => "bg-emerald-600")
		.exhaustive();
}

function impactLabel(impact: "high" | "medium" | "low") {
	return match(impact)
		.with("high", () =>
			t({
				comment: "Impact severity label in resume analysis suggestion card",
				message: "High",
			}),
		)
		.with("medium", () =>
			t({
				comment: "Impact severity label in resume analysis suggestion card",
				message: "Medium",
			}),
		)
		.with("low", () =>
			t({
				comment: "Impact severity label in resume analysis suggestion card",
				message: "Low",
			}),
		)
		.exhaustive();
}

export function ResumeAnalysisSectionBuilder() {
	const queryClient = useQueryClient();

	const resume = useResume();

	const resumeId = resume?.id ?? "";
	const providersQuery = useQuery(orpc.aiProviders.list.queryOptions());
	const aiEnabled =
		providersQuery.data?.some((provider) => provider.enabled && provider.testStatus === "success") ?? false;

	const analysisQuery = useQuery({
		...orpc.resume.analysis.getById.queryOptions({ input: { id: resumeId } }),
		enabled: !!resume,
	});

	const { mutate: analyzeResume, isPending } = useMutation({
		...orpc.ai.analyzeResume.mutationOptions(),
		onSuccess: (analysis) => {
			queryClient.setQueryData(orpc.resume.analysis.getById.queryKey({ input: { id: resumeId } }), analysis);
			toast.success(t`Resume analysis complete.`);
		},
		onError: (error) => {
			toast.error(t`Failed to analyze resume.`, {
				description: getOrpcErrorMessage(error, {
					byCode: {
						BAD_REQUEST: t({
							comment: "Error description when AI returns invalid resume analysis format",
							message: "The AI returned an invalid analysis format. Please try again.",
						}),
						BAD_GATEWAY: t({
							comment: "Error description when AI provider cannot be reached during resume analysis",
							message: "Could not reach the AI provider. Please try again.",
						}),
					},
					fallback: t({
						comment: "Fallback error description when resume analysis request fails",
						message: "Something went wrong while analyzing your resume.",
					}),
				}),
			});
		},
	});

	const [jdText, setJdText] = useState("");
	const [toolResult, setToolResult] = useState("");
	const [toolTitle, setToolTitle] = useState("");
	const [activeTool, setActiveTool] = useState("");

	const { mutate: runTool, isPending: toolPending } = useMutation({
		...orpc.ai.resumeToolkit.mutationOptions(),
		onSuccess: (text) => {
			setToolResult(text);
		},
		onError: (error) => {
			setActiveTool("");
			toast.error(t`Failed to generate.`, {
				description: getOrpcErrorMessage(error, {
					byCode: {
						BAD_GATEWAY: t({
							comment: "Error when AI provider cannot be reached for a resume toolkit action",
							message: "Could not reach the AI provider. Please try again.",
						}),
					},
					fallback: t({
						comment: "Fallback error when a resume toolkit action fails",
						message: "Something went wrong. Please try again.",
					}),
				}),
			});
		},
	});

	const toolkitItems = [
		{ kind: "impress-score" as const, label: t`Impress Score` },
		{ kind: "interview-questions" as const, label: t`Interview Prep` },
		{ kind: "linkedin" as const, label: t`LinkedIn` },
	];

	const analysis = analysisQuery.data;
	const score = analysis?.overallScore ?? null;
	const analyzeLabel = isPending ? t`Analyzing...` : t`Analyze Resume`;

	const scoreTone = useMemo(() => {
		if (score == null) return "bg-muted";
		if (score >= 80) return "bg-emerald-600";
		if (score >= 60) return "bg-amber-600";
		return "bg-rose-600";
	}, [score]);

	const onAnalyze = () => {
		if (!resume) return;

		analyzeResume({
			resumeId: resume.id,
		});
	};

	if (!resume) return null;

	return (
		<SectionBase type="analysis" className="space-y-4">
			{!aiEnabled && <DisabledState />}

			{aiEnabled && (
				<div className="space-y-3">
					<div className="space-y-4 rounded-md border bg-card p-3">
						<div className="grid grid-cols-2 items-center gap-3">
							<div>
								<p className="text-muted-foreground text-xs">
									<Trans>
										Get a review of your resume with an overall score, strengths, and actionable suggestions.
									</Trans>
								</p>
							</div>

							<Button disabled={isPending} onClick={onAnalyze} className="ml-auto w-fit">
								<SparkleIcon />
								{analyzeLabel}
							</Button>
						</div>

						<div className="grid grid-cols-[auto_1fr] items-center gap-3">
							<div
								className={`grid size-18 place-items-center rounded-full border-3 border-background font-bold text-lg text-white ${scoreTone}`}
							>
								{score ?? "--"}
							</div>

							<div className="space-y-3">
								<p className="font-medium text-sm leading-none">
									<Trans>Overall Score</Trans>
								</p>
								<div className="grid grid-cols-10 gap-1">
									{Array.from({ length: 10 }).map((_, index) => {
										const active = score != null && index < Math.round(score / 10);
										return (
											<div
												key={`scorebar-${index}`}
												className={`h-1.5 rounded-full transition-colors ${active ? "bg-primary" : "bg-muted"}`}
											/>
										);
									})}
								</div>
								{analysis?.updatedAt && (
									<p className="text-muted-foreground text-xs leading-none">
										<Trans>Last analyzed on {new Date(analysis.updatedAt).toLocaleString()}</Trans>
									</p>
								)}
							</div>
						</div>
					</div>

					<div className="space-y-3 rounded-md border bg-card p-3">
						<p className="text-muted-foreground text-xs">
							<Trans>Recruiter-view tools. Paste a job description for sharper results (optional).</Trans>
						</p>
						<textarea
							value={jdText}
							onChange={(event) => setJdText(event.target.value)}
							placeholder={t`Paste a job description (optional)…`}
							className="min-h-16 w-full resize-y rounded-md border bg-background p-2 text-sm"
						/>
						<div className="grid grid-cols-3 gap-2">
							{toolkitItems.map((item) => (
								<Button
									key={item.kind}
									size="sm"
									variant="outline"
									disabled={toolPending}
									onClick={() => {
										setActiveTool(item.kind);
										setToolTitle(item.label);
										setToolResult("");
										runTool({ resumeId: resume.id, kind: item.kind, jobDescription: jdText.trim() || undefined });
									}}
								>
									{toolPending && activeTool === item.kind ? t`…` : item.label}
								</Button>
							))}
						</div>
						{toolResult && (
							<div className="rounded-md border bg-muted/40 p-3">
								<h5 className="mb-2 font-semibold text-sm">{toolTitle}</h5>
								<div className="text-muted-foreground text-sm">
									<ReactMarkdown
										skipHtml
										components={{
											h1: ({ children }) => (
												<h4 className="mt-3 mb-1 font-semibold text-foreground text-sm first:mt-0">{children}</h4>
											),
											h2: ({ children }) => (
												<h4 className="mt-3 mb-1 font-semibold text-foreground text-sm first:mt-0">{children}</h4>
											),
											h3: ({ children }) => (
												<h5 className="mt-2 mb-1 font-medium text-foreground text-xs">{children}</h5>
											),
											p: ({ children }) => <p className="my-1.5 leading-relaxed first:mt-0">{children}</p>,
											ul: ({ children }) => <ul className="my-1.5 ms-4 list-disc space-y-0.5">{children}</ul>,
											ol: ({ children }) => <ol className="my-1.5 ms-4 list-decimal space-y-0.5">{children}</ol>,
											li: ({ children }) => <li className="ps-0.5">{children}</li>,
											strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
											em: ({ children }) => <em className="text-foreground/80 italic">{children}</em>,
										}}
									>
										{toolResult}
									</ReactMarkdown>
								</div>
							</div>
						)}
					</div>

					{analysisQuery.isFetched && !analysis && !isPending && (
						<div className="rounded-md border border-dashed p-3">
							<p className="max-w-xs text-muted-foreground text-sm">
								<Trans>Run your first analysis to get a scorecard, strengths, and prioritized suggestions.</Trans>
							</p>
						</div>
					)}

					{analysis && (
						<div className="space-y-4">
							<div className="space-y-3 rounded-md border p-3">
								<h5 className="flex items-center gap-2 font-semibold text-sm">
									<LightningIcon className="text-primary" />
									<Trans>Scorecard</Trans>
								</h5>

								<div className="space-y-3">
									{analysis.scorecard.map((item) => (
										<div key={item.dimension} className="space-y-3 rounded-md border bg-card p-3">
											<div className="flex items-center justify-between gap-2">
												<div className="font-medium text-sm">{item.dimension}</div>
												<Badge variant="secondary">{item.score}/100</Badge>
											</div>
											<p className="text-muted-foreground text-xs">{item.rationale}</p>
										</div>
									))}
								</div>
							</div>

							{analysis.strengths.length > 0 && (
								<div className="space-y-3 rounded-md border p-3">
									<h5 className="font-semibold text-sm">
										<Trans>Strengths</Trans>
									</h5>

									<ul className="list-outside list-disc pl-5 text-muted-foreground text-sm">
										{analysis.strengths.map((strength) => (
											<li key={strength} className="py-1.5">
												{strength}
											</li>
										))}
									</ul>
								</div>
							)}

							{analysis.suggestions.length > 0 && (
								<div className="space-y-4 rounded-md border p-3">
									<h5 className="font-semibold text-sm">
										<Trans>Suggestions</Trans>
									</h5>

									<div className="space-y-3">
										{analysis.suggestions.map((suggestion) => (
											<div key={suggestion.title} className="space-y-3 rounded-md border bg-card p-3">
												<div className="flex items-center gap-2">
													<span
														role="img"
														className={`size-2.5 shrink-0 rounded-full ring-1 ring-border ${impactCircleClass(suggestion.impact)}`}
														title={impactLabel(suggestion.impact)}
														aria-label={impactLabel(suggestion.impact)}
													/>
													<div className="font-semibold text-sm tracking-tight">{suggestion.title}</div>
												</div>

												<div className="text-muted-foreground text-xs">{suggestion.why}</div>

												{suggestion.exampleRewrite && (
													<div className="rounded bg-muted p-2 text-muted-foreground text-xs">
														{suggestion.exampleRewrite}
													</div>
												)}
											</div>
										))}
									</div>
								</div>
							)}
						</div>
					)}
				</div>
			)}
		</SectionBase>
	);
}

function DisabledState() {
	return (
		<Alert>
			<InfoIcon />
			<AlertDescription className="space-y-3">
				<p>
					<Trans>
						Get an in-depth AI-powered review of your resume with an overall score, key strengths, and practical
						suggestions. To activate this feature, please update your AI settings.
					</Trans>
				</p>

				<Button
					size="sm"
					variant="outline"
					nativeButton={false}
					render={
						<Link to="/dashboard/settings/integrations">
							<Trans>Open Integrations Settings</Trans>
							<ArrowRightIcon />
						</Link>
					}
				/>
			</AlertDescription>
		</Alert>
	);
}
