// Esc and taking queued messages back empty pi's whole queue, colleagues' messages included, and pi
// tells extensions nothing. This wraps the method that does it.
import { AgentSession } from "@earendil-works/pi-coding-agent";

type Listener = (session: string) => void;

const listeners = new Set<Listener>();
let installed = false;

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
	// Fail at startup rather than lose a colleague's message on the first Esc.
	if (typeof own !== "function")
		throw new Error("pi has no AgentSession.clearQueue: write to the pi");
	prototype.clearQueue = function clearQueue(this: { sessionId: string }) {
		const result = own.call(this);
		for (const listener of listeners) listener(this.sessionId);
		return result;
	};
}
