// Before mounting a feature, an app asks every other app on pi.events whether one already runs
// it. That is how the harness and a standalone copy of the same package avoid running a feature
// twice. The answer is a field written on the payload, which works because pi's event bus calls
// listeners synchronously. An app answers only while its runtime is live, and pi fires
// `session_shutdown` before a reload builds the next runtime.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { isObject, object, string } from "../decode.ts";

const CHANNEL = "harness:kit:claim";
const claimShape = object({ feature: string });

export function answerClaims(
	pi: ExtensionAPI,
	appName: string,
	mounted: ReadonlySet<string>,
	isLive: () => boolean,
): void {
	pi.events.on(CHANNEL, (data) => {
		const claim = claimShape.decode(data, "");
		if (!isLive() || !claim.ok || !isObject(data) || data.owner !== undefined) return;
		if (mounted.has(claim.value.feature)) data.owner = appName;
	});
}

/** The name of the app that already runs the feature, if one does. */
export function ownerOf(pi: ExtensionAPI, featureId: string): string | undefined {
	const claim: { feature: string; owner?: unknown } = { feature: featureId };
	pi.events.emit(CHANNEL, claim);
	return typeof claim.owner === "string" ? claim.owner : undefined;
}
