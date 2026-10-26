// The machine on its tailnet: what the daemon reads of `tailscale status`, who it lets in by `whois`,
// and that a page or a login over the tailnet gives the owner's device a login and nobody else one.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { requestLink } from "../src/cli/open.ts";
import { Logins } from "../src/daemon/auth.ts";
import { Clients } from "../src/daemon/clients.ts";
import { Daemon } from "../src/daemon/server.ts";
import { Sessions } from "../src/daemon/sessions.ts";
import { type AskTailscale, Owners, readTailnet, type Tailnet } from "../src/daemon/tailnet.ts";

const OWNER = 6629714470969663;
const OTHER = 1234;

/** `tailscale status --json` as this machine wrote it, cut to what the daemon reads. */
const STATUS = JSON.stringify({
	BackendState: "Running",
	Self: {
		DNSName: "ghost.curl-enigmatic.ts.net.",
		TailscaleIPs: ["100.104.113.100", "fd7a:115c:a1e0::c30:7165"],
		UserID: OWNER,
	},
});

function whois(user: number): string {
	return JSON.stringify({ Node: { User: user }, UserProfile: { ID: user, LoginName: "someone" } });
}

describe("the machine on its tailnet", () => {
	test("is its MagicDNS name without the dot, its IPv4 address and its owner", async () => {
		const ask: AskTailscale = async (args) => (args[0] === "status" ? STATUS : undefined);
		expect(await readTailnet(ask)).toEqual({
			name: "ghost.curl-enigmatic.ts.net",
			ip: "100.104.113.100",
			user: OWNER,
		});
	});

	test("is nothing when tailscale is missing, fails, or says nothing usable", async () => {
		expect(await readTailnet(async () => undefined)).toBeUndefined();
		expect(await readTailnet(async () => "not json")).toBeUndefined();
		expect(
			await readTailnet(async () => JSON.stringify({ Self: { DNSName: "" } })),
		).toBeUndefined();
	});
});

describe("who owns an address", () => {
	const tailnet: Tailnet = { name: "ghost.example.ts.net", ip: "100.1.1.1", user: OWNER };

	test("the owner's device is let in, and a device another user shares is not", async () => {
		const ask: AskTailscale = async (args) => whois(args[2] === "100.1.1.2" ? OWNER : OTHER);
		const owners = new Owners(tailnet, ask);
		expect(await owners.owns("100.1.1.2")).toBe(true);
		expect(await owners.owns("100.1.1.3")).toBe(false);
	});

	test("a whois that fails or answers nothing usable is a no", async () => {
		expect(await new Owners(tailnet, async () => undefined).owns("100.1.1.2")).toBe(false);
		expect(await new Owners(tailnet, async () => "{}").owns("100.1.1.2")).toBe(false);
	});

	test("an answer is kept for a minute, so a phone's requests do not each ask again", async () => {
		let asked = 0;
		let at = 0;
		const owners = new Owners(
			tailnet,
			async () => {
				asked += 1;
				return whois(OWNER);
			},
			() => at,
		);
		await owners.owns("100.1.1.2");
		at = 59_000;
		await owners.owns("100.1.1.2");
		expect(asked).toBe(1);
		at = 61_000;
		await owners.owns("100.1.1.2");
		expect(asked).toBe(2);
	});
});

/** A daemon's client port with a tailnet on a second loopback address, which Linux lets anyone bind. */
async function daemonOn(owner: boolean) {
	const dir = mkdtempSync(join(tmpdir(), "pi-remote-tailnet-"));
	writeFileSync(join(dir, "index.html"), "<!doctype html><title>app</title>");
	writeFileSync(join(dir, "app.js"), "export {};");
	writeFileSync(join(dir, "files.json"), JSON.stringify(["/index.html", "/app.js"]));
	const tailnet: Tailnet = { name: "ghost.example.ts.net", ip: "127.0.0.2", user: OWNER };
	const clients = new Clients({
		sessions: new Sessions(),
		logins: new Logins(join(dir, "logins.json")),
		version: "1.2.0",
		command: () => false,
		web: { dir, files: new Set(["/index.html", "/app.js"]), dynamic: [] },
		tailnet,
		owners: new Owners(tailnet, async () => whois(owner ? OWNER : OTHER)),
	});
	const listened = await clients.listen(0);
	if ("why" in listened) throw new Error(`no port: ${listened.why}`);
	return { clients, port: listened.port };
}

function ask(
	address: string,
	port: number,
	options: { method?: string; host: string; body?: string; path?: string },
): Promise<{ status: number; cookie: string | undefined }> {
	return new Promise((resolve, reject) => {
		const sent = request(
			{
				host: address,
				port,
				method: options.method ?? "GET",
				path: options.method === "POST" ? "/login" : (options.path ?? "/"),
				headers: {
					host: options.host,
					...(options.method === "POST"
						? { origin: `http://${options.host}`, "content-type": "application/json" }
						: {}),
				},
			},
			(response) => {
				response.resume();
				response.on("end", () =>
					resolve({
						status: response.statusCode ?? 0,
						cookie: response.headers["set-cookie"]?.[0],
					}),
				);
			},
		);
		sent.on("error", reject);
		sent.end(options.body);
	});
}

describe("a device that comes through the tailnet", () => {
	test("is the owner's: the page logs it in, and so does a login with no token", async () => {
		const { clients, port } = await daemonOn(true);
		const host = `ghost.example.ts.net:${port}`;
		expect(clients.tailnetUrl).toBe(`http://127.0.0.2:${port}/`);
		const page = await ask("127.0.0.2", port, { host });
		expect(page.status).toBe(200);
		expect(page.cookie).toStartWith("pi_remote=");
		const login = await ask("127.0.0.2", port, { method: "POST", host, body: "{}" });
		expect(login.status).toBe(204);
		expect(login.cookie).toStartWith("pi_remote=");
		clients.close();
	});

	test("is the owner's, and a script is only a script: the login comes with a page", async () => {
		const { clients, port } = await daemonOn(true);
		const script = await ask("127.0.0.2", port, {
			host: `ghost.example.ts.net:${port}`,
			path: "/app.js",
		});
		expect(script.status).toBe(200);
		expect(script.cookie).toBeUndefined();
		clients.close();
	});

	test("is another user's: the page loads with no login, and a login with no token is refused", async () => {
		const { clients, port } = await daemonOn(false);
		const host = `ghost.example.ts.net:${port}`;
		const page = await ask("127.0.0.2", port, { host });
		expect(page.status).toBe(200);
		expect(page.cookie).toBeUndefined();
		const login = await ask("127.0.0.2", port, { method: "POST", host, body: "{}" });
		expect(login.status).toBe(401);
		clients.close();
	});

	test("on loopback, the owner's answer gives nothing: only the tailnet's address logs in by who", async () => {
		const { clients, port } = await daemonOn(true);
		const page = await ask("127.0.0.1", port, { host: `127.0.0.1:${port}` });
		expect(page.status).toBe(200);
		expect(page.cookie).toBeUndefined();
		const login = await ask("127.0.0.1", port, {
			method: "POST",
			host: `127.0.0.1:${port}`,
			body: "{}",
		});
		expect(login.status).toBe(401);
		clients.close();
	});

	test("the address the link names answers too, as the name does", async () => {
		const { clients, port } = await daemonOn(true);
		const page = await ask("127.0.0.2", port, { host: `127.0.0.2:${port}` });
		expect(page.status).toBe(200);
		expect(page.cookie).toStartWith("pi_remote=");
		clients.close();
	});

	test("a name the daemon does not answer to is refused before anything is read", async () => {
		const { clients, port } = await daemonOn(true);
		const page = await ask("127.0.0.2", port, { host: `evil.example:${port}` });
		expect(page.status).toBe(421);
		expect(page.cookie).toBeUndefined();
		clients.close();
	});
});

describe("the link pi gives", () => {
	test("names the tailnet's address too, with no token, when the daemon listens there", async () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-remote-link-"));
		const socket = join(dir, "daemon.sock");
		const daemon = await Daemon.start({
			socket,
			version: "1.2.0",
			clientPort: 0,
			tailnet: { name: "ghost.example.ts.net", ip: "127.0.0.2", user: OWNER },
		});
		if (daemon === undefined) throw new Error("the daemon did not start");
		const link = await requestLink(socket);
		expect(link).toMatchObject({ tailnet: `http://127.0.0.2:${daemon.clientPort}/` });
		expect("url" in link ? link.url : "").toContain("#token=");
		await daemon.stop();
	});

	test("names only loopback on a machine with no tailnet", async () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-remote-link-"));
		const socket = join(dir, "daemon.sock");
		const daemon = await Daemon.start({ socket, version: "1.2.0", clientPort: 0 });
		if (daemon === undefined) throw new Error("the daemon did not start");
		const link = await requestLink(socket);
		expect(Object.keys(link).toSorted()).toEqual(["url"]);
		await daemon.stop();
	});
});
