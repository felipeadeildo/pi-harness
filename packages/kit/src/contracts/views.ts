// Showing a session over the screen. The look answers, and the panel and remote ask, so neither
// depends on the other. Raw channels, like the sources', because a request is answered in place.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { isObject } from "../decode.ts";
import { isSourceAddress, type SourceAddress } from "./sources.ts";

type Events = ExtensionAPI["events"];

/** A request to show a session over the screen. The look answers it. */
export const VIEW_OPEN = "harness:view.open";
/** A view provider answers this to say it can show a session right now. */
export const VIEW_AVAILABLE = "harness:view.available";

/** True when a feature in this process can show a session right now. */
export function canOpenView(events: Events): boolean {
	const probe = { available: false };
	events.emit(VIEW_AVAILABLE, probe);
	return probe.available;
}

/** Asks for `address` to be shown. False when nobody took the request. */
export function openView(events: Events, address: SourceAddress): boolean {
	const request = { address, opened: false };
	events.emit(VIEW_OPEN, request);
	return request.opened;
}

/** Shows sessions: says it is available, and takes a request when `open` returns true. */
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
