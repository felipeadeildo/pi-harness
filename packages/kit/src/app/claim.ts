// An app asks the others on pi.events whether one already runs a feature, so the harness and a
// standalone copy never run it twice. The bus is synchronous, so the answer is written on the payload.
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

export function ownerOf(pi: ExtensionAPI, featureId: string): string | undefined {
	const claim: { feature: string; owner?: unknown } = { feature: featureId };
	pi.events.emit(CHANNEL, claim);
	return typeof claim.owner === "string" ? claim.owner : undefined;
}
