// What moves in the room, and only to say something changed: an agent at work spins, one writing shows
// its words arriving, and a message that just came in keeps its rail lit for a moment. Every frame is
// a function of the clock, so a picture drawn at a given time always looks the same.

/** One frame of motion. The room redraws this often only while something moves. */
export const FRAME_MS = 100;
/** How long a new message keeps its rail lit. */
export const FRESH_MS = 4_000;

const SPINNER = [
	"\u280b",
	"\u2819",
	"\u2839",
	"\u2838",
	"\u283c",
	"\u2834",
	"\u2826",
	"\u2827",
	"\u2807",
	"\u280f",
] as const;

/** The spinner's frame at this time. Two agents that started apart still spin together. */
export function spin(now: number): string {
	return SPINNER[Math.floor(now / FRAME_MS) % SPINNER.length] ?? SPINNER[0];
}

/** Dots that grow while someone writes. */
export function dots(now: number): string {
	return [".  ", ".. ", "..."][Math.floor(now / 400) % 3] ?? "...";
}

/** The writing cursor, on for half a second and off for the next. */
export function blink(now: number): boolean {
	return Math.floor(now / 500) % 2 === 0;
}

export function isFresh(at: number, now: number): boolean {
	return now - at >= 0 && now - at < FRESH_MS;
}
