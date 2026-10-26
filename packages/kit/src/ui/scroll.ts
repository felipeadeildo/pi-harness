export interface ThumbRange {
	/** From the top. */
	start: number;
	/** At least one. */
	size: number;
}

/** Undefined when everything fits. */
export function thumbRange(total: number, height: number, scroll: number): ThumbRange | undefined {
	if (total <= height) return undefined;
	const size = Math.max(1, Math.round((height * height) / total));
	const start = Math.round((scroll / (total - height)) * (height - size));
	return { start, size };
}
