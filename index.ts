/**
 * pi-docent — LLM-generated, interactively replayed code tours.
 *
 * /tour                lists saved tours and plays the one you pick
 * /tour <topic>        plays the saved tour, or asks the agent to build one
 * /tour <topic> --refresh   regenerates
 * /tour <topic> <focus...>  extra guidance for generation
 *
 * Generation is a one-time agent run that must cite real file/line ranges
 * (validated on save). Playback reads files live from disk and costs zero
 * tokens. Press "a" on any step to ask the agent about it.
 */
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import { createSaveTourTool, generationPrompt } from "./generate.js";
import { TourPlayer, type PlayerResult } from "./player.js";
import {
	freshnessLabel,
	listTours,
	loadTour,
	slugify,
	tourFreshness,
} from "./storage.js";
import type { DocentState, Tour } from "./types.js";

export default function (pi: ExtensionAPI) {
	const state: DocentState = { cwd: null, autoPlaySlug: null };

	pi.registerTool(createSaveTourTool(state));

	pi.on("session_start", async (_event, ctx) => {
		state.cwd = ctx.cwd;
	});

	// A tour that was just saved replays as soon as the agent goes idle.
	pi.on("agent_end", async (_event, ctx) => {
		if (!state.autoPlaySlug) return;
		const slug = state.autoPlaySlug;
		state.autoPlaySlug = null;
		const tour = loadTour(ctx.cwd, slug);
		if (tour) await playTour(tour, ctx);
	});

	pi.registerCommand("tour", {
		description:
			"Take or create a guided code tour (usage: /tour [topic] [--refresh] [focus...])",
		getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
			if (!state.cwd) return null;
			const items = listTours(state.cwd)
				.filter((t) => t.slug.startsWith(prefix))
				.map((t) => ({ value: t.slug, label: t.slug, description: t.title }));
			return items.length > 0 ? items : null;
		},
		handler: async (args, ctx) => {
			const parts = args.trim().split(/\s+/).filter(Boolean);
			const refresh = parts.includes("--refresh");
			const words = parts.filter((p) => p !== "--refresh");
			const topic = words[0];
			const focus = words.slice(1).join(" ") || undefined;

			// No topic: pick from saved tours.
			if (!topic) {
				const tours = listTours(ctx.cwd);
				if (tours.length === 0) {
					ctx.ui.notify("No tours yet — run /tour <topic> to have the agent build one.", "info");
					return;
				}
				const labels = tours.map((t) => {
					const f = tourFreshness(ctx.cwd, t);
					return `${t.title} (${t.steps.length} steps, ${freshnessLabel(f)})`;
				});
				const choice = await ctx.ui.select("Take a tour:", labels);
				if (choice === undefined) return;
				const tour = tours[labels.indexOf(choice)];
				if (tour) await playTour(tour, ctx);
				return;
			}

			const slug = slugify(topic);
			if (!slug) {
				ctx.ui.notify(`"${topic}" is not a usable topic name.`, "error");
				return;
			}

			const existing = refresh ? null : loadTour(ctx.cwd, slug);
			if (existing) {
				const f = tourFreshness(ctx.cwd, existing);
				if (f.changed + f.missing > 0) {
					const choice = await ctx.ui.select(
						`"${existing.title}" references code that changed since it was generated.`,
						["Take it anyway", "Regenerate (uses the agent)", "Cancel"],
					);
					if (choice === undefined || choice === "Cancel") return;
					if (choice === "Take it anyway") {
						await playTour(existing, ctx);
						return;
					}
					// fall through to regenerate
				} else {
					await playTour(existing, ctx);
					return;
				}
			}

			// Generate (missing, --refresh, or user chose to regenerate).
			if (ctx.hasUI) {
				const ok = await ctx.ui.confirm(
					"Generate tour",
					`Ask the agent to explore "${topic}" and build a tour? This runs a normal agent turn (uses tokens); replaying it later is free.`,
				);
				if (!ok) return;
			}
			pi.sendUserMessage(generationPrompt(topic, slug, focus));
		},
	});

	async function playTour(tour: Tour, ctx: ExtensionContext): Promise<void> {
		if (ctx.mode !== "tui") {
			ctx.ui.notify(
				`Tour "${tour.title}" is interactive — open pi in a terminal and run /tour ${tour.slug}.`,
				"warning",
			);
			return;
		}
		const result = await ctx.ui.custom<PlayerResult>(
			(tui, theme, _keybindings, done) =>
				new TourPlayer(tour, ctx.cwd, theme, done, () => tui.requestRender()),
		);
		if (result && result.action === "ask") {
			const step = tour.steps[result.stepIndex];
			if (!step) return;
			ctx.ui.setEditorText(
				`In the "${tour.title}" tour, step ${result.stepIndex + 1} covers ${step.file}:${step.startLine}-${step.endLine} ("${step.title}"). Question: `,
			);
			ctx.ui.notify("Step context prefilled — type your question. Replay with /tour " + tour.slug, "info");
		}
	}
}
