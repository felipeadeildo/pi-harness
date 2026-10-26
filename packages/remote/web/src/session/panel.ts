/** Grows, never shrinks, so the composer does not move under the thumb. */
export function cap(previous: number, measured: number): number {
	return Math.max(previous, measured);
}
