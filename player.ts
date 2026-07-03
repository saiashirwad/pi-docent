import type { Theme } from "@earendil-works/pi-coding-agent";
import { getLanguageFromPath, highlightCode } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { resolveStep, type ResolvedStep } from "./storage.js";
import type { Tour } from "./types.js";

export type PlayerResult = { action: "quit" } | { action: "ask"; stepIndex: number };

const MAX_CODE_LINES = 24;

/**
 * Interactive tour player. Page 0 is the itinerary; pages 1..N are the steps.
 * Code is read live from disk on every visit, so what you see is the file as
 * it exists now (with a warning when it drifted from what the tour recorded).
 */
export class TourPlayer {
	private page = 0;
	private cache: { width: number; lines: string[] } | null = null;
	private resolved = new Map<number, ResolvedStep>();

	constructor(
		private readonly tour: Tour,
		private readonly cwd: string,
		private readonly theme: Theme,
		private readonly done: (result: PlayerResult) => void,
		private readonly requestRender: () => void,
	) {}

	private get pageCount(): number {
		return this.tour.steps.length + 1;
	}

	handleInput(data: string): void {
		const next =
			matchesKey(data, Key.right) ||
			matchesKey(data, Key.enter) ||
			matchesKey(data, Key.space) ||
			data === "n" ||
			data === "j";
		const prev = matchesKey(data, Key.left) || data === "p" || data === "k";

		if (next) {
			if (this.page < this.pageCount - 1) {
				this.page++;
				this.refresh();
			} else {
				this.done({ action: "quit" });
			}
		} else if (prev) {
			if (this.page > 0) {
				this.page--;
				this.refresh();
			}
		} else if (data === "a" && this.page > 0) {
			this.done({ action: "ask", stepIndex: this.page - 1 });
		} else if (data === "q" || matchesKey(data, Key.escape)) {
			this.done({ action: "quit" });
		}
	}

	private refresh(): void {
		this.cache = null;
		this.requestRender();
	}

	invalidate(): void {
		this.cache = null;
	}

	render(width: number): string[] {
		if (this.cache && this.cache.width === width) return this.cache.lines;
		const lines = this.page === 0 ? this.renderIntro(width) : this.renderStep(width, this.page - 1);
		this.cache = { width, lines };
		return lines;
	}

	private renderIntro(width: number): string[] {
		const t = this.theme;
		const out: string[] = [];
		out.push(this.headerLine(width, "itinerary"));
		out.push("");
		for (const line of wrapTextWithAnsi(this.tour.overview, width)) out.push(line);
		out.push("");
		this.tour.steps.forEach((step, i) => {
			out.push(
				truncateToWidth(
					`  ${t.fg("accent", String(i + 1).padStart(2))} ${step.title} ${t.fg("dim", `· ${step.file}`)}`,
					width,
				),
			);
		});
		out.push("");
		out.push(this.footerLine(width, false));
		return out;
	}

	private renderStep(width: number, stepIndex: number): string[] {
		const t = this.theme;
		const step = this.tour.steps[stepIndex]!;

		let resolved = this.resolved.get(stepIndex);
		if (!resolved) {
			resolved = resolveStep(this.cwd, step);
			this.resolved.set(stepIndex, resolved);
		}

		const out: string[] = [];
		out.push(this.headerLine(width, `step ${stepIndex + 1}/${this.tour.steps.length}`));
		out.push("");
		out.push(truncateToWidth(t.bold(step.title), width));
		out.push(
			truncateToWidth(
				t.fg("accent", `${step.file}:${resolved.startLine}-${resolved.endLine}`),
				width,
			),
		);

		if (resolved.status === "missing") {
			out.push(truncateToWidth(t.fg("error", "⚠ this file no longer exists"), width));
		} else if (resolved.status === "changed") {
			out.push(
				truncateToWidth(
					t.fg("warning", "⚠ file changed since the tour was generated — this excerpt may not match the explanation (regenerate with /tour <topic> --refresh)"),
					width,
				),
			);
		} else if (resolved.status === "moved") {
			out.push(
				truncateToWidth(t.fg("dim", "(file edited since generation; range re-anchored)"), width),
			);
		}
		out.push("");

		if (resolved.lines) {
			const total = resolved.endLine - resolved.startLine + 1;
			const shown = Math.min(total, MAX_CODE_LINES);
			const raw = resolved.lines
				.slice(resolved.startLine - 1, resolved.startLine - 1 + shown)
				.join("\n");
			const highlighted = highlightCode(raw, getLanguageFromPath(step.file));
			const gutterWidth = String(resolved.startLine + shown - 1).length;
			highlighted.forEach((codeLine, i) => {
				const lineNo = String(resolved!.startLine + i).padStart(gutterWidth);
				out.push(truncateToWidth(`${t.fg("dim", `${lineNo} │ `)}${codeLine}`, width));
			});
			if (total > shown) {
				out.push(truncateToWidth(t.fg("dim", `   … ${total - shown} more lines in this range`), width));
			}
			out.push("");
		}

		for (const line of wrapTextWithAnsi(step.explanation, width)) out.push(line);
		out.push("");
		out.push(this.footerLine(width, true));
		return out;
	}

	private headerLine(width: number, suffix: string): string {
		const t = this.theme;
		return truncateToWidth(
			`${t.fg("accent", t.bold(`Tour: ${this.tour.title}`))} ${t.fg("dim", `— ${suffix}`)}`,
			width,
		);
	}

	private footerLine(width: number, onStep: boolean): string {
		const t = this.theme;
		const ask = onStep ? " · a ask about this step" : "";
		return truncateToWidth(
			t.fg("dim", `→/enter next · ← prev${ask} · q quit`),
			width,
		);
	}
}
