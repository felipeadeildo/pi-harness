// Why a read from the daemon failed, as a sentence a screen shows.
import { DaemonAnswer } from "@adeildo/pi-remote-protocol/client";

/** The daemon's own words when it refused, and a plain sentence when it could not be reached. */
export function whyOf(error: unknown, what: string): string {
	if (error instanceof DaemonAnswer) {
		if (error.reason !== undefined) return capitalized(error.reason);
		if (error.status === 401) return "Not logged in. Ask pi for a new link with /remote.";
		if (error.status === 502) return "That machine did not answer.";
		return `The daemon answered ${error.status} for ${what}.`;
	}
	return `The daemon could not be reached for ${what}.`;
}

function capitalized(text: string): string {
	const sentence = text.charAt(0).toUpperCase() + text.slice(1);
	return sentence.endsWith(".") ? sentence : `${sentence}.`;
}
