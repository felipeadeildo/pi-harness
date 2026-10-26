// The world a daemon test needs: a temporary socket, a daemon that listens on a free port, a fake
// bridge, and the real client transport. One mounting, shared by every file that speaks to the daemon.
import { afterEach, beforeEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { connect as dial, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	applyChange,
	emptySessionState,
	envelope,
	type Envelope,
	isStateChangeType,
	PROTOCOL,
} from "@adeildo/pi-remote-protocol";
import { type Transport } from "@adeildo/pi-remote-protocol/client";

import { Daemon } from "../src/daemon/server.ts";
import type { Cursor } from "../src/daemon/sessions.ts";
import { envelopeOf, line, Lines } from "../src/wire/lines.ts";
import { logIn } from "./login.ts";

/** Registers the temporary socket and folder this file's daemons use, and clears them after. */
export function useDaemon(): void {
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "pi-remote-clients-"));
		socket = join(dir, "remote", "daemon.sock");
	});
	afterEach(() => {
		for (const daemon of running.splice(0)) daemon.stop();
		rmSync(dir, { recursive: true, force: true });
	});
}

export let dir: string;
export let socket: string;
export const running: Daemon[] = [];

export async function openDaemon(): Promise<{ daemon: Daemon; port: number; cookie: string }> {
	const daemon = await Daemon.start({ socket, version: "1.2.0", clientPort: 0 });
	if (daemon?.clientPort === undefined) throw new Error("the daemon did not start");
	running.push(daemon);
	const port = daemon.clientPort;
	return { daemon, port, cookie: await logIn(daemon, port) };
}

/**
 * The events after a cursor, refusing the gap the replay cannot fill: `after` answers `undefined`
 * for it, which no amount of waiting turns into a page, so waiting on it hangs instead of failing.
 */
export function missed(daemon: Daemon, session: string, cursor: Cursor): Envelope[] {
	const events = daemon.sessions.after(session, cursor);
	if (events === undefined)
		throw new Error(`the replay dropped what followed seq ${cursor.seq}, so it never arrives`);
	return events;
}

/**
 * A bridge as the daemon sees one: a hello, `session.live`, events with a seq, and an answer to
 * `state.get`, which tells whether the daemon asked for one.
 */
export async function bridgeOf(session: string, epoch = "e1", file?: string, path = socket) {
	const at = { machine: "laptop", session, epoch };
	const client: Socket = dial(path);
	await new Promise<void>((resolve) => client.once("connect", () => resolve()));
	const asked: Envelope[] = [];
	const lines = new Lines();
	let seq = 0;
	// The real bridge folds the state it sends, so the fake folds it too: what a client reads is the
	// same whether the state came from the log or from here.
	let harness = emptySessionState();
	const send = (type: string, data: unknown) => {
		if (isStateChangeType(type)) harness = applyChange(harness, type, data);
		client.write(line(envelope("event", type, data, { ...at, seq: seq++ })));
	};
	const state = (entries: unknown[]) =>
		send("state", {
			summary: { session, machine: "laptop", cwd: "/repo", kind: "terminal", state: harness },
			entries,
		});
	client.setEncoding("utf8");
	client.on("data", (chunk: string) => {
		for (const text of lines.push(chunk)) {
			const message = envelopeOf(text);
			if (message?.kind === "command") asked.push(message);
		}
	});
	client.write(line(envelope("hello", "bridge", { protocol: PROTOCOL, version: "1.2.0" }, at)));
	client.write(
		line(
			envelope(
				"event",
				"session.live",
				{
					pid: 1,
					startedAt: 1,
					cwd: "/repo",
					kind: "terminal",
					...(file === undefined ? {} : { file }),
				},
				at,
			),
		),
	);
	const reply = (id: string, type: string, data: unknown) =>
		client.write(line(envelope("reply", type, data, { ...at, id })));
	return { send, state, asked, reply, close: () => client.destroy() };
}

/** The P3 client over a real WebSocket, so the daemon is held to what the app will send. */
export function transportTo(port: number, cookie: string) {
	return (onMessage: (envelope: unknown) => void, onClose: () => void): Transport => {
		const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
			headers: { Origin: `http://127.0.0.1:${port}`, Cookie: cookie },
		});
		const queued: string[] = [];
		ws.onopen = () => {
			for (const text of queued.splice(0)) ws.send(text);
		};
		ws.onmessage = (event) => onMessage(JSON.parse(String(event.data)));
		ws.onclose = () => onClose();
		return {
			send: (message) => {
				const text = JSON.stringify(message);
				if (ws.readyState === WebSocket.OPEN) ws.send(text);
				else queued.push(text);
			},
			close: () => ws.close(),
		};
	};
}

export function entry(id: string, parentId: string | null) {
	return { type: "message", id, parentId, timestamp: "", message: { role: "user", content: id } };
}
