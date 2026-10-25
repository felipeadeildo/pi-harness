import { describe, expect, test } from "bun:test";
import { connect as dial } from "node:net";

import { portRefused } from "../src/daemon/server.ts";
import { bridgeOf, entry, openDaemon, useDaemon } from "./daemon-harness.ts";
import { until } from "./fakes.ts";

useDaemon();

describe("who reaches the daemon", () => {
	/** A raw upgrade with the headers a page would send, and the status line the daemon answers. */
	async function upgrade(port: number, headers: string): Promise<string> {
		const raw = dial(port, "127.0.0.1");
		let answer = "";
		raw.setEncoding("utf8");
		raw.on("data", (chunk: string) => (answer += chunk));
		await new Promise<void>((resolve) => raw.once("connect", () => resolve()));
		raw.write(
			`GET /ws HTTP/1.1\r\n${headers}Upgrade: websocket\r\nConnection: Upgrade\r\n` +
				"Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n",
		);
		await until(() => answer.includes("\r\n"));
		raw.destroy();
		return answer.slice(0, answer.indexOf("\r\n"));
	}

	test("a WebSocket from another page's Origin, or with none, is refused", async () => {
		const { port, cookie } = await openDaemon();
		const host = `Host: 127.0.0.1:${port}\r\n`;
		expect(await upgrade(port, `${host}Origin: https://evil.example\r\n`)).toBe(
			"HTTP/1.1 403 Forbidden",
		);
		expect(await upgrade(port, `${host}Origin: null\r\n`)).toStartWith("HTTP/1.1 403");
		expect(await upgrade(port, host)).toStartWith("HTTP/1.1 403");
		expect(
			await upgrade(port, `${host}Origin: http://localhost:${port}\r\nCookie: ${cookie}\r\n`),
		).toStartWith("HTTP/1.1 101");
	});

	test("a name the daemon does not answer to gets 421, so a rebound DNS name reads nothing", async () => {
		const { daemon, port, cookie } = await openDaemon();
		const bridge = await bridgeOf("s1");
		bridge.state([entry("a", null)]);
		await until(() => daemon.sessions.get("s1")?.opening !== undefined);
		const status = (host: string) =>
			new Promise<number>((resolve) => {
				const raw = dial(port, "127.0.0.1");
				let answer = "";
				raw.setEncoding("utf8");
				raw.on("data", (chunk: string) => (answer += chunk));
				raw.on("close", () => resolve(Number(answer.split(" ")[1])));
				raw.write(
					`GET /sessions/laptop/s1/opening HTTP/1.1\r\nHost: ${host}\r\nCookie: ${cookie}\r\nConnection: close\r\n\r\n`,
				);
			});
		expect(await status(`attacker.example:${port}`)).toBe(421);
		expect(await status(`127.0.0.1:${port}`)).toBe(200);
		expect(
			await upgrade(
				port,
				`Host: attacker.example:${port}\r\nOrigin: http://attacker.example:${port}\r\n`,
			),
		).toStartWith("HTTP/1.1 421");
	});
});

describe("a port that will not open", () => {
	test("says the cause the error gave, and where the port is changed", () => {
		expect(portRefused(7878, "EADDRINUSE")).toBe(
			"port 7878 is already in use by another program; the port is set in Alt+S › Remote",
		);
		expect(portRefused(80, "EACCES")).toBe(
			"port 80 needs privilege to be opened; the port is set in Alt+S › Remote",
		);
		expect(portRefused(7878, undefined)).toContain("no reason given");
	});
});
