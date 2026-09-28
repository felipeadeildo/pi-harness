// How features talk to each other. Everything goes over pi.events, which every extension in a pi
// process shares, so the same code works whether both features live in one app or come from two
// packages installed apart. A payload from another package may come from an older or newer
// version of it, so it is decoded on arrival. Payloads can gain fields but never lose them.
//
// An event that crosses packages is declared in `contracts/`, never in the package that emits
// it, so the package that listens does not have to depend on the package that emits.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { type Decoder, formatProblems } from "./decode.ts";

/** What an event needs to travel. A feature scope is one. */
export interface EventScope {
	readonly pi: ExtensionAPI;
	warn(message: string): void;
}

export interface HarnessEvent<T> {
	/** The pi.events channel: `harness:` and the name. */
	readonly channel: string;
	emit(scope: EventScope, payload: T): void;
	/** A payload that does not decode is dropped with a warning. */
	on(scope: EventScope, listener: (payload: T) => void): () => void;
}

/** Name it `<area>:<what happened>`, like `providers:account-changed`. */
export function defineEvent<T>(name: string, decoder: Decoder<T>): HarnessEvent<T> {
	const channel = `harness:${name}`;
	return {
		channel,
		emit(scope, payload) {
			scope.pi.events.emit(channel, payload);
		},
		on(scope, listener) {
			return scope.pi.events.on(channel, (data) => {
				const result = decoder.decode(data, name);
				if (result.ok) listener(result.value);
				else scope.warn(`ignored a ${name} event: ${formatProblems(result.problems).join("; ")}`);
			});
		},
	};
}
