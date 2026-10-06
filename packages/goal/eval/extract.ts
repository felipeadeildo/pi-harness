// Every goal call a session recorded, with what its model read, so a case can be cut from it.
// bun packages/goal/eval/extract.ts > packages/goal/eval/.calls.jsonl
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { emptyGoal, GOAL_ENTRY, type GoalUpdate, type SessionGoal } from "@adeildo/pi-kit";

import { lastMessage, workSince } from "../src/transcript.ts";

interface Entry {
	id: string;
	parentId: string | null;
	type: string;
	customType?: string;
	data?: GoalUpdate;
	message?: unknown;
	timestamp: string;
}

const root = join(homedir(), ".pi/agent/sessions");

for (const folder of readdirSync(root)) {
	for (const file of readdirSync(join(root, folder))) {
		if (!file.endsWith(".jsonl")) continue;
		const text = readFileSync(join(root, folder, file), "utf8");
		if (!text.includes(GOAL_ENTRY)) continue;
		calls(
			text
				.split("\n")
				.filter(Boolean)
				.map((line) => JSON.parse(line) as Entry),
			file,
		);
	}
}

function calls(entries: Entry[], file: string): void {
	const byId = new Map(entries.map((entry) => [entry.id, entry]));
	for (const entry of entries) {
		if (entry.type !== "custom" || entry.customType !== GOAL_ENTRY || entry.data === undefined)
			continue;
		const read = pathTo(entry, byId).slice(0, -1);
		const update = entry.data;
		const to = update.covers?.to;
		const upTo = to === undefined ? read : read.slice(0, read.findIndex((e) => e.id === to) + 1);
		let news = "";
		let asked: string | undefined;
		if (update.trigger === "message") {
			// The message is the newest of yours before the update; older updates recorded the wrong one.
			news = lastMessage(read)?.text ?? "";
		} else if (update.trigger === "work") {
			const fromIndex = upTo.findIndex((e) => e.id === update.covers?.from);
			news = workSince(upTo, upTo[fromIndex - 1]?.id).text;
			asked = lastMessage(upTo)?.text;
		} else continue;
		console.log(
			JSON.stringify({
				id: `${file.slice(0, 19)}/${entry.id}`,
				at: entry.timestamp,
				trigger: update.trigger,
				state: previousState(read),
				news,
				asked,
				got: update.ops,
				model: update.model,
			}),
		);
	}
}

function pathTo(entry: Entry, byId: Map<string, Entry>): Entry[] {
	const path: Entry[] = [];
	for (let at: Entry | undefined = entry; at; at = at.parentId ? byId.get(at.parentId) : undefined)
		path.unshift(at);
	return path;
}

function previousState(branch: Entry[]): SessionGoal {
	for (let index = branch.length - 1; index >= 0; index--) {
		const entry = branch[index];
		if (entry?.type === "custom" && entry.customType === GOAL_ENTRY && entry.data)
			return entry.data.state;
	}
	return emptyGoal();
}
