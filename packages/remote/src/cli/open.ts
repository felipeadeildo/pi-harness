// `pi-remote open`: asks the daemon over the unix socket for a one-minute link, prints it and opens it.
import { randomUUID } from "node:crypto";
import { connect } from "node:net";

import { envelope, type Envelope, isObject, PROTOCOL } from "@adeildo/pi-remote-protocol";

import { openInBrowser } from "../browser.ts";
import { VERSION } from "../version.ts";
import { envelopeOf, line, Lines } from "../wire/lines.ts";

/** How long the command waits for the daemon. */
const ANSWER_MS = 3_000;

/** `tailnet` is the address the owner's devices open with no token. */
export type Link = { url: string; tailnet?: string } | { reason: string };

/** The daemon builds the link, since only it knows its port. */
export function linkOf(answer: Envelope | undefined, silence: string): Link {
	const data = isObject(answer?.data) ? answer.data : {};
	if (answer?.kind === "reply" && typeof data.url === "string") {
		return {
			url: data.url,
			...(typeof data.tailnet === "string" ? { tailnet: data.tailnet } : {}),
		};
	}
	if (answer?.kind === "error" && typeof data.reason === "string") return { reason: data.reason };
	return { reason: silence };
}

/** Asks the daemon on the socket for a link. */
export function requestLink(socketPath: string): Promise<Link> {
	return new Promise((resolve) => {
		const socket = connect(socketPath);
		const id = randomUUID();
		const lines = new Lines();
		const done = (answer: Envelope | undefined): void => {
			clearTimeout(timer);
			socket.destroy();
			resolve(linkOf(answer, NO_DAEMON));
		};
		const timer = setTimeout(() => done(undefined), ANSWER_MS);
		socket.setEncoding("utf8");
		socket.on("error", () => done(undefined));
		socket.on("close", () => done(undefined));
		socket.on("connect", () => {
			socket.write(line(envelope("hello", "cli", { protocol: PROTOCOL, version: VERSION })));
			socket.write(line(envelope("command", "token.issue", {}, { id })));
		});
		socket.on("data", (chunk: string) => {
			for (const text of lines.push(chunk)) {
				const message = envelopeOf(text);
				if (message?.id === id) done(message);
			}
		});
	});
}

const NO_DAEMON = "no daemon answered; a pi in a terminal starts one, and so does pi-remote serve";

/** Prints the link and opens it, or says why there is none. Returns the exit code. */
export async function open(
	socketPath: string,
	out: (line: string) => void,
	err: (line: string) => void,
	browse: (url: string) => void = openInBrowser,
): Promise<number> {
	const link = await requestLink(socketPath);
	if ("reason" in link) {
		err(`pi-remote: ${link.reason}`);
		return 1;
	}
	out(`${link.url}\n(good once, for a minute)`);
	if (link.tailnet !== undefined) out(`On your devices on the tailnet: ${link.tailnet}`);
	browse(link.url);
	return 0;
}
