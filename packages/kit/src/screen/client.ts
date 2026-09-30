import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
	APPLY,
	type ApplyRequest,
	DONE,
	LIST,
	type ListRequest,
	type RowView,
	RUN,
	type RunDone,
	type RunRequest,
	type TabView,
} from "../contracts/screen.ts";
import type { Json } from "../control.ts";
import { isObject } from "../decode.ts";

type Events = ExtensionAPI["events"];

/** Tabs with the same title, from features of different packages, become one. */
export function listTabs(events: Events): TabView[] {
	const request: ListRequest = { tabs: [] };
	events.emit(LIST, request);

	const merged: TabView[] = [];
	for (const tab of request.tabs) {
		if (tab.rows.length === 0) continue;
		const same = merged.find((entry) => entry.title === tab.title);
		if (same === undefined) {
			merged.push({ title: tab.title, sections: [...tab.sections], rows: [...tab.rows] });
			continue;
		}
		for (const section of tab.sections)
			if (!same.sections.includes(section)) same.sections.push(section);
		same.rows.push(...tab.rows);
	}
	return merged;
}

/** Returns why the change was refused. */
export function applyRow(
	events: Events,
	row: RowView,
	op: ApplyRequest["op"],
	value?: Json,
): string | undefined {
	const request: ApplyRequest = { feature: row.feature, id: row.id, op };
	if (value !== undefined) request.value = value;
	events.emit(APPLY, request);
	if (request.answer === undefined) return `${row.feature} is not running`;
	return request.answer.error;
}

export function runRow(events: Events, row: RowView): Promise<Omit<RunDone, "request">> {
	const id = crypto.randomUUID();
	return new Promise((resolve) => {
		const stop = events.on(DONE, (data) => {
			if (!isObject(data) || data.request !== id) return;
			stop();
			resolve({
				...(typeof data.text === "string" ? { text: data.text } : {}),
				...(typeof data.error === "string" ? { error: data.error } : {}),
			});
		});

		const request: RunRequest = { feature: row.feature, id: row.id, request: id };
		events.emit(RUN, request);
		const refused =
			request.answer === undefined ? `${row.feature} is not running` : request.answer.error;
		if (refused !== undefined) {
			stop();
			resolve({ error: refused });
		}
	});
}
