// Showing a session over the screen: the look answers, the panel and remote ask. Raw channels, like the sources'.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { isObject } from "../decode.ts";
import { isSourceAddress, type SourceAddress } from "./sources.ts";

type Events = ExtensionAPI["events"];

export const VIEW_OPEN = "harness:view.open";
export const VIEW_AVAILABLE = "harness:view.available";

export function canOpenView(events: Events): boolean {
	const probe = { available: false };
	events.emit(VIEW_AVAILABLE, probe);
	return probe.available;
}

/** False when nobody took the request. */
export function openView(events: Events, address: SourceAddress): boolean {
	const request = { address, opened: false };
	events.emit(VIEW_OPEN, request);
	return request.opened;
}

export function provideViews(
	events: Events,
	open: (address: SourceAddress) => boolean,
	available: () => boolean = () => true,
): () => void {
	const stops = [
		events.on(VIEW_AVAILABLE, (data) => {
			if (isObject(data) && available()) data.available = true;
		}),
		events.on(VIEW_OPEN, (data) => {
			if (!isObject(data) || data.opened === true || !isSourceAddress(data.address)) return;
			data.opened = open(data.address);
		}),
	];
	return () => {
		for (const stop of stops) stop();
	};
}
