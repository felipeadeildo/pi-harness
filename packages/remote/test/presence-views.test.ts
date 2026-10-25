import { expect, test } from "bun:test";

import { type By, envelope, type Envelope } from "@adeildo/pi-remote-protocol";

import { bridgeOf, openDaemon, useDaemon } from "./daemon-harness.ts";
import { until } from "./fakes.ts";

useDaemon();

test("the clients watching a session are named, and the latest input marks the active one", async () => {
	const { daemon, port, cookie } = await openDaemon();
	const bridge = await bridgeOf("s1");
	bridge.state([]);
	await until(() => daemon.sessions.get("s1") !== undefined);
	const origin = `http://127.0.0.1:${port}`;
	const open = async (name: string): Promise<{ ws: WebSocket; heard: Envelope[] }> => {
		const heard: Envelope[] = [];
		const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
			headers: { Origin: origin, Cookie: cookie },
		});
		ws.onmessage = (event) => heard.push(JSON.parse(String(event.data)) as Envelope);
		await new Promise<void>((resolve) => (ws.onopen = () => resolve()));
		ws.send(
			JSON.stringify(
				envelope(
					"hello",
					"hello",
					{
						by: { kind: "client", name, machine: "laptop" },
					},
					{ machine: "laptop", session: "s1" },
				),
			),
		);
		await until(() => heard.length > 0);
		return { ws, heard };
	};
	const phone = await open("phone");
	const laptop = await open("laptop");
	await until(() =>
		phone.heard.some(
			(one) =>
				one.type === "presence.changed" &&
				(one.data as { viewers: unknown[] }).viewers.length === 2,
		),
	);
	const joined = phone.heard.filter((one) => one.type === "presence.changed").at(-1)?.data as {
		viewers: { name: string }[];
		active?: { name: string };
	};
	expect(joined.viewers.map((one) => one.name).sort()).toEqual(["laptop", "phone"]);
	expect(joined.active).toBeUndefined();

	// A command is input, so whoever sends it is the one the session answers now.
	laptop.ws.send(
		JSON.stringify(
			envelope(
				"command",
				"run.abort",
				{},
				{
					session: "s1",
					id: "c1",
					by: { kind: "client", name: "laptop", machine: "laptop" },
				},
			),
		),
	);
	await until(() =>
		phone.heard.some(
			(one) =>
				one.type === "presence.changed" &&
				(one.data as { active?: { name: string } }).active?.name === "laptop",
		),
	);
	const moved = phone.heard.filter((one) => one.type === "presence.changed").at(-1)?.data as {
		active?: { name: string };
	};
	expect(moved.active?.name).toBe("laptop");

	// A second command from the same client changes nothing, so nothing is said twice.
	const before = phone.heard.filter((one) => one.type === "presence.changed").length;
	laptop.ws.send(
		JSON.stringify(
			envelope(
				"command",
				"run.abort",
				{},
				{
					session: "s1",
					id: "c2",
					by: { kind: "client", name: "laptop", machine: "laptop" },
				},
			),
		),
	);
	await until(() => bridge.asked.filter((one) => one.type === "run.abort").length === 2);
	await Bun.sleep(20);
	expect(phone.heard.filter((one) => one.type === "presence.changed")).toHaveLength(before);

	// One leaving is one viewer fewer, and the mark goes with it: nobody there has the last input.
	laptop.ws.close();
	const presence = () =>
		phone.heard.filter((one) => one.type === "presence.changed").at(-1)?.data as
			| { viewers: { name: string; machine: string }[]; active?: By }
			| undefined;
	await until(() => presence()?.viewers.length === 1);
	expect(presence()).toEqual({ viewers: [{ name: "phone", machine: "laptop" }] });
	phone.ws.close();
	bridge.close();
});

test("the terminal is a viewer, and typing there takes the mark from a client", async () => {
	const { daemon, port, cookie } = await openDaemon();
	const bridge = await bridgeOf("s1");
	bridge.state([]);
	await until(() => daemon.sessions.get("s1") !== undefined);
	const heard: Envelope[] = [];
	const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
		headers: { Origin: `http://127.0.0.1:${port}`, Cookie: cookie },
	});
	ws.onmessage = (event) => heard.push(JSON.parse(String(event.data)) as Envelope);
	await new Promise<void>((resolve) => (ws.onopen = () => resolve()));
	const by = { kind: "client", name: "phone", machine: "laptop" } as const;
	ws.send(JSON.stringify(envelope("hello", "hello", { by }, { machine: "laptop", session: "s1" })));
	await until(() => heard.some((one) => one.type === "presence.changed"));
	// A client's command takes the mark.
	ws.send(JSON.stringify(envelope("command", "run.abort", {}, { session: "s1", id: "c1", by })));
	const presence = () =>
		heard.filter((one) => one.type === "presence.changed").at(-1)?.data as
			| { viewers: { name: string }[]; active?: { kind: string } }
			| undefined;
	await until(() => presence()?.active?.kind === "client");
	// And a key at the terminal takes it back, with the terminal named as the one typing there.
	bridge.send("presence.here", {
		by: { kind: "terminal", name: "otter", machine: "laptop" },
	});
	await until(() => presence()?.active?.kind === "terminal");
	expect(presence()).toMatchObject({
		viewers: [
			{ name: "otter", machine: "laptop" },
			{ name: "phone", machine: "laptop" },
		],
		active: { kind: "terminal", name: "otter" },
	});
	ws.close();
	bridge.close();
});

test("a key at the terminal reaches the others as presence, never as the keypress itself", async () => {
	const { daemon, port, cookie } = await openDaemon();
	const bridge = await bridgeOf("s1");
	bridge.state([]);
	await until(() => daemon.sessions.get("s1") !== undefined);
	const heard: Envelope[] = [];
	const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
		headers: { Origin: `http://127.0.0.1:${port}`, Cookie: cookie },
	});
	ws.onmessage = (event) => heard.push(JSON.parse(String(event.data)) as Envelope);
	await new Promise<void>((resolve) => (ws.onopen = () => resolve()));
	ws.send(
		JSON.stringify(
			envelope(
				"hello",
				"hello",
				{ by: { kind: "client", name: "phone", machine: "laptop" } },
				{
					machine: "laptop",
					session: "s1",
				},
			),
		),
	);
	await until(() => heard.length > 0);
	const before = heard.length;
	bridge.send("presence.here", { by: { kind: "terminal", name: "otter", machine: "laptop" } });
	await until(() =>
		heard.some(
			(one) =>
				one.type === "presence.changed" &&
				(one.data as { active?: { kind: string } }).active?.kind === "terminal",
		),
	);
	// What arrived is the presence, and the keypress itself was not forwarded.
	expect(heard.slice(before).map((one) => one.type)).toEqual(["presence.changed"]);
	ws.close();
	bridge.close();
});
