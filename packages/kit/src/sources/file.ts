// A session read from its file on this machine, followed as pi appends to it. It only reads: the
// file has no open questions, no queue and no way in.
import {
	calculateContextTokens,
	type ExtensionAPI,
	type SessionEntry,
} from "@earendil-works/pi-coding-agent";

import {
	askSource,
	type SessionSummary,
	type SessionSource,
	type SourceAddress,
} from "../contracts/sources.ts";
import { HOST } from "../events/log.ts";
import { FileTail, followFile, type FileRecord, type TailItem } from "./follow.ts";

export interface FileSourceOptions {
	/** How often to look at the file when the directory watch stays quiet, in milliseconds. */
	every?: number;
}

/**
 * The source for `address`: a provider's, such as remote's, or else the session's file when it is on
 * this machine. Undefined when neither can show it.
 */
export function sourceFor(
	events: ExtensionAPI["events"],
	address: SourceAddress,
	options: FileSourceOptions = {},
): SessionSource | undefined {
	const provided = askSource(events, address);
	if (provided !== undefined) return provided;
	if (address.machine !== HOST || address.file === undefined) return undefined;
	return fileSource(address.file, options);
}

export function fileSource(path: string, options: FileSourceOptions = {}): SessionSource {
	return {
		snapshot() {
			const fold = new Fold();
			for (const item of new FileTail(path).poll()) fold.apply(item);
			const snapshot = fold.snapshot();
			if (snapshot === undefined) return Promise.reject(new Error(`no session in ${path} yet`));
			return Promise.resolve(snapshot);
		},
		follow(after, on) {
			const fold = new Fold();
			// Entries up to the cursor only feed the snapshot.
			let waiting = after?.entry;
			// A cursor with nothing this source reads, such as a newer one, is a cursor it does not know.
			if (after !== undefined && waiting === undefined) on({ kind: "reset" });
			let sent = "";
			return followFile(
				path,
				(items) => {
					if (items[0]?.kind === "reset") {
						fold.reset();
						on({ kind: "reset" });
					}
					let entries = items.flatMap((item) => fold.apply(item));
					if (waiting !== undefined) {
						const at = entries.findIndex((entry) => entry.id === waiting);
						// The first read holds the whole file, so a cursor it lacks is one the file does not know.
						if (at === -1) on({ kind: "reset" });
						entries = entries.slice(at + 1);
						waiting = undefined;
					}
					for (const entry of entries) on({ kind: "entry", entry });
					const snapshot = fold.snapshot();
					const text = JSON.stringify(snapshot);
					if (snapshot === undefined || text === sent) return;
					sent = text;
					on({ kind: "snapshot", snapshot });
				},
				{ every: options.every },
			);
		},
	};
}

/** What the file says of the live state, from its header and the entries that change it. */
class Fold {
	#header: { session: string; cwd: string } | undefined;
	#rest: Omit<SessionSummary, "session" | "machine" | "cwd"> = {};

	reset(): void {
		this.#header = undefined;
		this.#rest = {};
	}

	/** Takes in one item, and returns it as an entry when it is one. */
	apply(item: TailItem): SessionEntry[] {
		if (item.kind === "reset") return [];
		const record = item.record;
		if (record.type === "session") {
			if (typeof record.cwd === "string") this.#header = { session: record.id, cwd: record.cwd };
			return [];
		}
		if (!isEntry(record)) return [];
		this.#rest = { ...this.#rest, ...changes(record), leafId: record.id };
		return [record];
	}

	snapshot(): SessionSummary | undefined {
		if (this.#header === undefined) return undefined;
		return { ...this.#header, machine: HOST, ...this.#rest };
	}
}

function changes(entry: SessionEntry): Partial<SessionSummary> {
	switch (entry.type) {
		case "session_info":
			return { name: entry.name };
		case "model_change":
			return { model: { provider: entry.provider, id: entry.modelId } };
		case "thinking_level_change":
			return { thinkingLevel: entry.thinkingLevel };
		case "compaction":
			// Pi does not know the context's size again until the next answer.
			return { context: undefined };
		case "message": {
			const message = entry.message;
			if (message.role !== "assistant") return {};
			const model = { provider: message.provider, id: message.model };
			if (message.stopReason === "aborted" || message.stopReason === "error") return { model };
			const tokens = calculateContextTokens(message.usage);
			return tokens > 0 ? { model, context: { tokens } } : { model };
		}
		default:
			return {};
	}
}

function isEntry(record: FileRecord): record is FileRecord & SessionEntry {
	return typeof record.type === "string" && "parentId" in record;
}
