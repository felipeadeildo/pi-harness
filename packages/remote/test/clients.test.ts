// Who composes the daemon's two halves: one `session.gone` reaches the sockets and the paged file's
// index in the same call, so a relaunch under the same id starts with neither of them.
import { describe, expect, test } from "bun:test";

import { envelope } from "@adeildo/pi-remote-protocol";

import { Logins } from "../src/daemon/auth.ts";
import { Clients } from "../src/daemon/clients.ts";
import { Sessions } from "../src/daemon/sessions.ts";
import type { WebSocket } from "../src/wire/websocket.ts";

/** A socket as the hub uses it: it sends, it reports its backlog, and it closes. */
function socket(): WebSocket {
	return {
		send: () => {},
		pending: () => 0,
		close: () => {},
	} as unknown as WebSocket;
}

function composed(): { clients: Clients; sessions: Sessions; file: string } {
	const sessions = new Sessions();
	const file = "/sessions/s1.jsonl";
	const at = { machine: "laptop", session: "s1", epoch: "e1" };
	sessions.live(envelope("event", "session.live", {}, at), {
		pid: 1,
		startedAt: 1,
		cwd: "/repo",
		kind: "terminal",
		file,
	} as never);
	const clients = new Clients({
		sessions,
		logins: new Logins(`/tmp/pi-remote-compose-${process.pid}.json`),
		version: "1.2.0",
		askSnapshot: () => false,
		command: () => false,
	});
	return { clients, sessions, file };
}

describe("one session.gone, two halves", () => {
	test("lets go of the watchers and the file's index, so a relaunch starts clean", () => {
		const { clients, file } = composed();
		// A client opens the session, so the daemon holds presence for it.
		const opened = clients.hub.open(socket());
		opened.message(
			JSON.stringify(
				envelope(
					"hello",
					"hello",
					{ by: { kind: "client", name: "phone", machine: "laptop" } },
					{ machine: "laptop", session: "s1" },
				),
			),
		);
		expect(clients.hub.watched().get("s1")).toBe(1);

		// The one call the daemon makes for a `session.gone`, and it returns what each half let go of.
		expect(clients.forget("s1")).toEqual({ watching: 1, file });
		expect(clients.hub.watched().get("s1")).toBeUndefined();
		clients.close();
	});

	test("a session nobody watches still has its file index forgotten", () => {
		const { clients, file } = composed();
		// No socket opened: the hub has nothing to forget, and the file still does.
		expect(clients.forget("s1")).toEqual({ watching: 0, file });
		clients.close();
	});
});
