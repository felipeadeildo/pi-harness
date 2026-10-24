// `pi-remote open`: asks the daemon for a link good once for a minute, prints it and opens it. It
// speaks to the daemon over the same unix socket as a bridge, says hello as `cli`, and leaves as soon
// as the daemon answers. Without a daemon it says so: only a pi starts one.
import { randomUUID } from "node:crypto";
import { connect } from "node:net";

import { envelope, isObject, PROTOCOL } from "@adeildo/pi-remote-protocol";

import { openInBrowser } from "../browser.ts";
import { VERSION } from "../version.ts";
import { envelopeOf, line, Lines } from "../wire/lines.ts";

/** How long the command waits for the daemon. */
const ANSWER_MS = 3_000;

/** Asks the daemon for a token. Resolves with nothing when no daemon answers in time. */
export function issueToken(socketPath: string): Promise<string | undefined> {
	return new Promise((resolve) => {
		const socket = connect(socketPath);
		const id = randomUUID();
		const lines = new Lines();
		const done = (token: string | undefined): void => {
			clearTimeout(timer);
			socket.destroy();
			resolve(token);
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
				if (message?.kind !== "reply" || message.id !== id) continue;
				const token = isObject(message.data) ? message.data.token : undefined;
				done(typeof token === "string" ? token : undefined);
			}
		});
	});
}

/** Prints the link and opens it, or says why there is none. Returns the exit code. */
export async function open(
	socketPath: string,
	port: number,
	out: (line: string) => void,
	err: (line: string) => void,
	browse: (url: string) => void = openInBrowser,
): Promise<number> {
	const token = await issueToken(socketPath);
	if (token === undefined) {
		err("pi-remote: no daemon answered; it starts with a pi in a terminal");
		return 1;
	}
	const url = `http://127.0.0.1:${port}/#token=${token}`;
	out(`${url}\n(good once, for a minute)`);
	browse(url);
	return 0;
}
