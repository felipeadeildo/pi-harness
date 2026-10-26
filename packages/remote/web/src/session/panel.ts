// The panel that holds a question is measured as it renders, and this is the one rule the measurement
// follows. It lives apart from the component so the rule can be read and proved without a device.

/**
 * The panel's height while it is open: it may grow, never shrink. A question with two options after
 * one with four must not move the composer under the thumb that is about to press it.
 */
export function cap(previous: number, measured: number): number {
	return Math.max(previous, measured);
}
