import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import type { Tour, TourStep } from "./types.js";

/** Tours live in the project (committable, shareable with the team). */
export function toursDir(cwd: string): string {
	return join(cwd, CONFIG_DIR_NAME, "docent");
}

export function slugify(topic: string): string {
	return topic
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 60);
}

export function hashContent(content: string): string {
	return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

export function tourPath(cwd: string, slug: string): string {
	return join(toursDir(cwd), `${slug}.json`);
}

export function saveTour(cwd: string, tour: Tour): string {
	mkdirSync(toursDir(cwd), { recursive: true });
	const path = tourPath(cwd, tour.slug);
	writeFileSync(path, `${JSON.stringify(tour, null, 2)}\n`, "utf-8");
	return path;
}

export function loadTour(cwd: string, slug: string): Tour | null {
	try {
		const tour = JSON.parse(readFileSync(tourPath(cwd, slug), "utf-8")) as Tour;
		if (!tour || !Array.isArray(tour.steps)) return null;
		return tour;
	} catch {
		return null;
	}
}

export function listTours(cwd: string): Tour[] {
	let files: string[];
	try {
		files = readdirSync(toursDir(cwd));
	} catch {
		return [];
	}
	const tours: Tour[] = [];
	for (const file of files.sort()) {
		if (!file.endsWith(".json")) continue;
		const tour = loadTour(cwd, file.slice(0, -".json".length));
		if (tour) tours.push(tour);
	}
	return tours;
}

/**
 * A step re-checked against the file as it exists right now.
 *
 * - "fresh":   file unchanged since the tour was generated
 * - "moved":   file changed but the anchor line was found once — range re-anchored
 * - "changed": file changed and the anchor could not be located — showing recorded range
 * - "missing": file no longer exists
 */
export interface ResolvedStep {
	lines: string[] | null;
	startLine: number;
	endLine: number;
	status: "fresh" | "moved" | "changed" | "missing";
}

export function resolveStep(cwd: string, step: TourStep): ResolvedStep {
	let content: string;
	try {
		content = readFileSync(join(cwd, step.file), "utf-8");
	} catch {
		return { lines: null, startLine: step.startLine, endLine: step.endLine, status: "missing" };
	}
	const lines = content.split("\n");

	if (hashContent(content) === step.fileHash) {
		return { lines, startLine: step.startLine, endLine: step.endLine, status: "fresh" };
	}

	// File changed. Try to re-anchor on the recorded first line (only if distinctive
	// and it appears exactly once).
	if (step.anchor.trim().length >= 4) {
		const matches: number[] = [];
		for (let i = 0; i < lines.length; i++) {
			if (lines[i] === step.anchor) matches.push(i + 1);
		}
		if (matches.length === 1) {
			const start = matches[0]!;
			const span = step.endLine - step.startLine;
			return {
				lines,
				startLine: start,
				endLine: Math.min(start + span, lines.length),
				status: "moved",
			};
		}
	}

	const start = Math.max(1, Math.min(step.startLine, lines.length));
	return {
		lines,
		startLine: start,
		endLine: Math.max(start, Math.min(step.endLine, lines.length)),
		status: "changed",
	};
}

export interface Freshness {
	fresh: number;
	moved: number;
	changed: number;
	missing: number;
}

export function tourFreshness(cwd: string, tour: Tour): Freshness {
	const f: Freshness = { fresh: 0, moved: 0, changed: 0, missing: 0 };
	for (const step of tour.steps) f[resolveStep(cwd, step).status]++;
	return f;
}

export function freshnessLabel(f: Freshness): string {
	if (f.missing > 0 || f.changed > 0) return "outdated";
	if (f.moved > 0) return "slightly outdated";
	return "fresh";
}
