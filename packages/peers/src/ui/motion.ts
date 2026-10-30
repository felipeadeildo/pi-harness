// Every frame comes from the clock, so a picture drawn at a given time always looks the same.
import { SPIN } from "@adeildo/pi-kit";

export const FRAME_MS = 100;

export function spin(now: number): string {
	return SPIN.braille[Math.floor(now / FRAME_MS) % SPIN.braille.length] ?? SPIN.braille[0];
}
