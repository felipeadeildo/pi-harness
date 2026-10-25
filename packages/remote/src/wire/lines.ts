// How a bridge and its daemon talk over the unix socket: one JSON envelope per line, split on LF
// only. JSON escapes every LF inside a string, so a line never holds part of two messages. The
// daemon bundles this file, so it imports only the protocol package, which imports nothing.
import { type Envelope, isEnvelope } from "@adeildo/pi-remote-protocol";

/** A line longer than this is a bug on the other side, and is dropped instead of held. */
const MAX_LINE = 32 * 1024 * 1024;

export function line(envelope: Envelope): string {
	return `${JSON.stringify(envelope)}\n`;
}

/** The envelope a line holds, or nothing when it is not JSON or not an envelope this version reads. */
export function envelopeOf(text: string): Envelope | undefined {
	try {
		const value: unknown = JSON.parse(text);
		return isEnvelope(value) ? value : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Cuts a stream of text into lines. It holds what follows the last LF until the rest arrives, and
 * drops a line that grows past `max`, up to its LF, so one bad message never takes the memory.
 */
export class Lines {
	#pending = "";
	#dropping = false;

	constructor(
		private readonly oversize: () => void = () => {},
		private readonly max = MAX_LINE,
	) {}

	push(chunk: string): string[] {
		const out: string[] = [];
		let start = 0;
		for (let lf = chunk.indexOf("\n"); lf !== -1; lf = chunk.indexOf("\n", start)) {
			// The length is measured before the line is built, so an oversized one never is.
			if (this.#dropping) this.#dropping = false;
			else if (this.#pending.length + lf - start > this.max) this.oversize();
			else out.push(this.#pending + chunk.slice(start, lf));
			this.#pending = "";
			start = lf + 1;
		}
		if (this.#dropping) return out;
		if (this.#pending.length + chunk.length - start > this.max) {
			this.#pending = "";
			this.#dropping = true;
			this.oversize();
			return out;
		}
		this.#pending += chunk.slice(start);
		return out;
	}
}
