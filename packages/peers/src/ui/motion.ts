// Every frame comes from the clock, so a picture drawn at a given time always looks the same.
import { SPIN } from "@adeildo/pi-kit";

export const FRAME_MS = 100;
export const FRESH_MS = 4_000;

export function spin(now: number): string {
	return SPIN.braille[Math.floor(now / FRAME_MS) % SPIN.braille.length] ?? SPIN.braille[0];
}

export function dots(now: number): string {
	return [".  ", ".. ", "..."][Math.floor(now / 400) % 3] ?? "...";
}

export function blink(now: number): boolean {
	return Math.floor(now / 500) % 2 === 0;
}

export function isFresh(at: number, now: number): boolean {
	return now - at >= 0 && now - at < FRESH_MS;
}
