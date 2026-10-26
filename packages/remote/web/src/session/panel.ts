// The panel that holds a question is measured as it renders, and this is the one rule the measurement
// follows. It lives apart from the component so the rule can be read and proved without a device.

/** Grows, never shrinks, so the composer does not move under the thumb. */
export function cap(previous: number, measured: number): number {
	return Math.max(previous, measured);
}
