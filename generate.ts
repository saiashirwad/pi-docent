import { readFileSync } from "node:fs";
import { isAbsolute, join, normalize } from "node:path";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { hashContent, saveTour, slugify } from "./storage.js";
import type { DocentState, Tour, TourStep } from "./types.js";

const MIN_STEPS = 3;
const MAX_STEPS = 15;
const MAX_SPAN = 150;

const SaveTourParams = Type.Object({
	topic: Type.String({
		description: "Short topic id for this tour, e.g. 'auth' or 'billing-webhooks'",
	}),
	title: Type.String({ description: "Human-friendly tour title" }),
	overview: Type.String({
		description:
			"2-4 sentence plain-language overview: what the feature does and the overall shape of the flow",
	}),
	steps: Type.Array(
		Type.Object({
			file: Type.String({ description: "Repo-relative file path" }),
			startLine: Type.Integer({
				minimum: 1,
				description: "First line of the code this step discusses (1-based, inclusive)",
			}),
			endLine: Type.Integer({
				minimum: 1,
				description: "Last line of the code this step discusses (1-based, inclusive)",
			}),
			title: Type.String({ description: "Short step heading" }),
			explanation: Type.String({
				description:
					"Plain-language explanation for a developer new to this repo: what this code does, why it exists, and how it connects to the previous step. Define repo-specific names when first used.",
			}),
		}),
		{ minItems: MIN_STEPS, maxItems: MAX_STEPS },
	),
});

interface SaveTourDetails {
	slug: string;
	path: string;
	stepCount: number;
	title: string;
}

export function createSaveTourTool(state: DocentState) {
	return defineTool({
		name: "save_tour",
		label: "Save Tour",
		description:
			"Save a guided code tour (an ordered walkthrough of real file/line ranges with explanations) so the user can replay it interactively with /tour. Every line range must reference lines you have actually read in this conversation.",
		promptSnippet: "Save a guided code tour of a feature for interactive replay",
		promptGuidelines: [
			"Use save_tour when the user asks for a tour, walkthrough, or guided onboarding of a feature or subsystem. Read every referenced file before calling it; cite exact 1-based line ranges.",
		],
		parameters: SaveTourParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const cwd = ctx.cwd;
			const slug = slugify(params.topic);
			const problems: string[] = [];
			if (!slug) problems.push(`topic "${params.topic}" produces an empty slug; use letters/digits`);

			const steps: TourStep[] = [];
			params.steps.forEach((step, i) => {
				const label = `step ${i + 1} (${step.file}:${step.startLine}-${step.endLine})`;
				if (isAbsolute(step.file) || normalize(step.file).startsWith("..")) {
					problems.push(`${label}: file must be a repo-relative path inside the project`);
					return;
				}
				let content: string;
				try {
					content = readFileSync(join(cwd, step.file), "utf-8");
				} catch {
					problems.push(`${label}: file does not exist — use the exact path you read`);
					return;
				}
				const lines = content.split("\n");
				if (step.endLine < step.startLine) {
					problems.push(`${label}: endLine is before startLine`);
					return;
				}
				if (step.endLine > lines.length) {
					problems.push(`${label}: file only has ${lines.length} lines — re-read it and use real line numbers`);
					return;
				}
				if (step.endLine - step.startLine > MAX_SPAN) {
					problems.push(`${label}: range spans ${step.endLine - step.startLine + 1} lines; keep each step under ${MAX_SPAN} lines and split large flows into more steps`);
					return;
				}
				steps.push({
					file: step.file,
					startLine: step.startLine,
					endLine: step.endLine,
					title: step.title,
					explanation: step.explanation,
					fileHash: hashContent(content),
					anchor: lines[step.startLine - 1] ?? "",
				});
			});

			if (problems.length > 0) {
				throw new Error(
					`Tour not saved. Fix these and call save_tour again:\n- ${problems.join("\n- ")}`,
				);
			}

			const tour: Tour = {
				slug,
				topic: params.topic,
				title: params.title,
				overview: params.overview,
				generatedAt: new Date().toISOString(),
				steps,
			};
			const path = saveTour(cwd, tour);

			// Replay it for the user as soon as the agent goes idle (see agent_end in index.ts).
			if (ctx.mode === "tui") state.autoPlaySlug = slug;

			return {
				content: [
					{
						type: "text" as const,
						text: `Tour "${params.title}" saved with ${steps.length} steps. The user can replay it anytime with /tour ${slug}.`,
					},
				],
				details: { slug, path, stepCount: steps.length, title: params.title } satisfies SaveTourDetails,
				// End the turn here: the tour is the deliverable, no closing prose needed.
				terminate: true,
			};
		},

		renderResult(result, _options, theme) {
			const details = result.details as SaveTourDetails | undefined;
			if (!details) {
				const first = result.content[0];
				return new Text(first?.type === "text" ? first.text : "", 0, 0);
			}
			const lines = [
				theme.fg("success", `● Tour saved: ${theme.bold(details.title)}`),
				theme.fg("muted", `  ${details.stepCount} steps · replay anytime with /tour ${details.slug}`),
			];
			return new Text(lines.join("\n"), 0, 0);
		},
	});
}

export function generationPrompt(topic: string, slug: string, focus?: string): string {
	const focusLine = focus ? `\nPay special attention to: ${focus}\n` : "";
	return `Create a guided code tour to onboard a developer who is completely new to this repository.

Topic: ${topic}
${focusLine}
Work in two phases.

PHASE 1 — EXPLORE (do this first):
1. Find the code that implements "${topic}" (search the repo, then read the relevant files).
2. Read every file you plan to reference. Never cite a file or line range you have not read in this conversation.
3. Identify the narrative: where the flow enters, what happens next, where state/data lives, how errors are handled, and how it is tested (if it is).

PHASE 2 — SAVE:
Call the save_tour tool exactly once with topic "${slug}" and 5-10 steps. Requirements:
- Each step's file/startLine/endLine must point at real lines you just read (1-based, inclusive). Keep each range tight and under ~60 lines — the specific code being explained, not whole files.
- Order the steps as a story a newcomer can follow: entry point first, then the core flow, then supporting pieces.
- Write each explanation for a smart developer who has never seen this repo: plain language first, then the repo-specific names they will need to grep. Explain WHY the code is shaped the way it is whenever you can tell, not just what it does.
- Make each explanation connect to the previous step so the tour reads as one continuous walkthrough.

Rules:
- This is a read-only task. Do not create, modify, or delete any files.
- If you cannot find code matching the topic, say so briefly and do not call save_tour.
- If save_tour reports validation problems, fix them and call it again.
- After save_tour succeeds, stop. Do not write a closing summary.`;
}
