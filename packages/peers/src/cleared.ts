// Esc while the agent runs, and taking your queued messages back, empty pi's whole queue: yours, and
// the colleagues' messages this package put there, which would then be lost without a word. Pi says
// nothing to extensions when that happens, so this wraps the method that does it.
import { AgentSession } from "@earendil-works/pi-coding-agent";

type Listener = (session: string) => void;

const listeners = new Set<Listener>();
let installed = false;

/** Calls `listener` with the session's id each time pi empties that session's queue. */
export function onQueueCleared(listener: Listener): () => void {
	install();
	listeners.add(listener);
	return () => listeners.delete(listener);
}

function install(): void {
	if (installed) return;
	installed = true;
	const prototype = AgentSession.prototype as unknown as {
		clearQueue(this: { sessionId: string }): unknown;
	};
	const own = prototype.clearQueue;
	// pi drawing the queue itself is the only notice an extension gets, so a pi without this method is
	// a pi where a colleague's message disappears without a word. Fail at startup, loudly, instead of
	// wrapping `undefined` and finding out on the first Esc.
	if (typeof own !== "function")
		throw new Error("pi has no AgentSession.clearQueue: write to the pi");
	prototype.clearQueue = function clearQueue(this: { sessionId: string }) {
		const result = own.call(this);
		for (const listener of listeners) listener(this.sessionId);
		return result;
	};
}
