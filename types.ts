/** A single stop on a tour: a real range of lines plus a plain-language explanation. */
export interface TourStep {
	/** Repo-relative file path */
	file: string;
	/** 1-based, inclusive */
	startLine: number;
	/** 1-based, inclusive */
	endLine: number;
	/** Short step heading */
	title: string;
	/** Plain-language explanation written for someone new to the repo */
	explanation: string;
	/** Content hash of the file when the tour was generated (staleness detection) */
	fileHash: string;
	/** Exact text of startLine when generated (re-anchoring after edits) */
	anchor: string;
}

export interface Tour {
	slug: string;
	topic: string;
	title: string;
	overview: string;
	generatedAt: string;
	steps: TourStep[];
}

/** Extension-lifetime state shared between the command, the tool, and event handlers. */
export interface DocentState {
	/** Project root, captured at session_start (needed by autocomplete which has no ctx). */
	cwd: string | null;
	/** Slug of a tour that was just saved and should auto-play when the agent goes idle. */
	autoPlaySlug: string | null;
}
