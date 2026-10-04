// Refreshing an account's OAuth token, serialized across pi processes: the provider rotates the
// refresh token on use, and the disk copy wins when another process already refreshed it.
import type { Credential, OAuthAuth, OAuthCredential } from "@earendil-works/pi-ai";

import { withLock } from "./lock.ts";

const MARGIN_MS = 5 * 60 * 1000;

export function needsRefresh(credential: Credential | undefined): boolean {
	return credential?.type === "oauth" && credential.expires <= Date.now() + MARGIN_MS;
}

/** Where a refresh reads the newest copy and writes its result. */
export interface Renewal {
	freshen(id: string): Credential | undefined;
	save(id: string, credential: Credential): void;
}

/** Refreshes under the shared lock, keeping what another pi already wrote. */
export async function refreshAccount(
	oauth: OAuthAuth,
	renewal: Renewal,
	id: string,
	credential: OAuthCredential,
	signal: AbortSignal,
	lockPath?: string,
): Promise<OAuthCredential> {
	const work = async (): Promise<OAuthCredential> => {
		const onDisk = renewal.freshen(id);
		if (onDisk?.type === "oauth" && !needsRefresh(onDisk)) return onDisk;
		const fresh = await oauth.refresh(credential, signal);
		renewal.save(id, fresh);
		return fresh;
	};
	return lockPath === undefined ? await work() : await withLock(lockPath, work);
}
