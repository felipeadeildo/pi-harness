// What a deep link says, read from the link itself. The parser of the platform drops the port and the
// fragment, and the daemon's link carries both: the address with its port, and the token in the fragment.

/** The parts of an address the login and the socket need, from a page or from a link. */
export interface Link {
	protocol: string;
	host: string;
	pathname: string;
	search: string;
	hash: string;
}

const URL_LIKE = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/;

/**
 * The address a link names. A link without a host is refused, not guessed: `localhost` would open the
 * phone itself, and the daemon is rarely there.
 *
 * The token stays in the fragment because the fragment is never sent: no request carries it, so it
 * reaches no access log and no `Referer`. Reading it there is what the web link does too.
 */
export function parseLink(url: string): Link | undefined {
	const found = URL_LIKE.exec(url.trim());
	if (found === null) return undefined;
	const [, protocol, host, pathname, search, hash] = found;
	if (host === undefined || host === "") return undefined;
	return {
		protocol: protocol ?? "piremote",
		host,
		pathname: pathname ?? "",
		search: search ?? "",
		hash: hash ?? "",
	};
}
