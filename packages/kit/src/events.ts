// How features talk to each other. Everything goes over pi.events, which every extension
// in a Pi process shares, so the same code works whether both features live in one app or
// come from two packages installed apart. A payload from another package may come from an
// older or newer version, so it is decoded on arrival. Payloads only ever grow.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { type Decoder, formatProblems } from "./decode.ts";

export interface EventScope {
	readonly pi: ExtensionAPI;
	warn(source: string, message: string): void;
}

export interface HarnessEvent<T> {
	/** The pi.events channel, `harness:` plus the name. */
	readonly channel: string;
	emit(scope: EventScope, payload: T): void;
	/** Payloads that fail to decode are dropped with a warning. */
	on(scope: EventScope, listener: (payload: T) => void): () => void;
}

/** `name` reads best as `<feature>:<what happened>`, like `providers:account-changed`. */
export function defineEvent<T>(name: string, decoder: Decoder<T>): HarnessEvent<T> {
	const channel = `harness:${name}`;
	return {
		channel,
		emit: (scope, payload) => scope.pi.events.emit(channel, payload),
		on: (scope, listener) =>
			scope.pi.events.on(channel, (data) => {
				const result = decoder.decode(data, name);
				if (!result.ok) {
					scope.warn(name, `ignored an event: ${formatProblems(result.problems).join("; ")}`);
					return;
				}
				listener(result.value);
			}),
	};
}
