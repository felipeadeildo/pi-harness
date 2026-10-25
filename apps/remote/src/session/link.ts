// Where the app finds the daemon: the page's own address on the web, the opening link on a phone.
import * as Linking from "expo-linking";

import { type Link, parseLink } from "./link-parse.ts";

export type { Link };

/** What the page it was loaded from says. */
export function pageLink(): Link {
	const { protocol, host, pathname, search, hash } = globalThis.location;
	return { protocol, host, pathname, search, hash };
}

/** The address the link that opened the app names. */
export function linkOf(url: string): Link | undefined {
	return parseLink(Linking.parse(url));
}

/** The link that opened the app, which is where a phone learns the daemon's address. */
export function openingUrl(): Promise<string | undefined | null> {
	return Linking.getInitialURL();
}
