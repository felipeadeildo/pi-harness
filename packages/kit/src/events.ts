// How features talk to each other, over pi.events, which every extension in a process shares. A
// payload is decoded on arrival, because it may come from another version of the other package.
//
// An event that crosses packages is declared in `contracts/`, never in the package that emits it,
// so the listener does not depend on the emitter.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { type Decoder, formatProblems } from "./decode.ts";

export interface EventScope {
	readonly pi: ExtensionAPI;
	warn(message: string): void;
}

export interface HarnessEvent<T> {
	/** The pi.events channel: `harness:` and the name. */
	readonly channel: string;
	emit(scope: EventScope, payload: T): void;
	on(scope: EventScope, listener: (payload: T) => void): () => void;
}

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
