// The machine's place on a tailnet, from the `tailscale` command. Without it, or when it fails or
// is slow, the daemon listens on loopback only.
import { execFile } from "node:child_process";

import { isObject } from "@adeildo/pi-remote-protocol";

const ASK_MS = 2_000;

/** So a phone's requests do not each start a process. */
const KEPT_MS = 60_000;

export interface Tailnet {
	name: string;
	ip: string;
	user: number;
}

export type AskTailscale = (args: readonly string[]) => Promise<string | undefined>;

const askTailscale: AskTailscale = (args) =>
	new Promise((resolve) => {
		execFile("tailscale", [...args], { timeout: ASK_MS }, (error, stdout) =>
			resolve(error === null ? stdout : undefined),
		);
	});

export async function readTailnet(ask: AskTailscale = askTailscale): Promise<Tailnet | undefined> {
	return nodeOf(parsed(await ask(["status", "--json"]))?.Self);
}

/** Nodes other users share into the tailnet are left out. */
export async function readOwnTailnet(
	ask: AskTailscale = askTailscale,
): Promise<{ self: Tailnet; others: Tailnet[] } | undefined> {
	const status = parsed(await ask(["status", "--json"]));
	const self = nodeOf(status?.Self);
	if (self === undefined) return undefined;
	const others = Object.values(recordOf(status?.Peer) ?? {}).flatMap((peer) => {
		const node = nodeOf(peer);
		return node?.user === self.user && recordOf(peer)?.Online === true ? [node] : [];
	});
	return { self, others };
}

function nodeOf(value: unknown): Tailnet | undefined {
	const node = recordOf(value);
	if (node === undefined) return undefined;
	const name = typeof node.DNSName === "string" ? node.DNSName.replace(/\.$/, "") : "";
	const ip = Array.isArray(node.TailscaleIPs)
		? node.TailscaleIPs.find((one): one is string => typeof one === "string" && one.includes("."))
		: undefined;
	const user = node.UserID;
	if (name === "" || ip === undefined || typeof user !== "number") return undefined;
	return { name, ip, user };
}

/** Anything but a clear yes from `whois` is a no, and the device logs in with a link. */
export class Owners {
	readonly #known = new Map<string, { owned: boolean; until: number }>();

	constructor(
		private readonly tailnet: Tailnet,
		private readonly ask: AskTailscale = askTailscale,
		private readonly now: () => number = Date.now,
	) {}

	async owns(address: string): Promise<boolean> {
		const at = this.now();
		const known = this.#known.get(address);
		if (known !== undefined && known.until > at) return known.owned;
		const answer = recordOf(parsed(await this.ask(["whois", "--json", address])));
		const owned = recordOf(answer?.UserProfile)?.ID === this.tailnet.user;
		this.#known.set(address, { owned, until: at + KEPT_MS });
		return owned;
	}
}

function parsed(text: string | undefined): Record<string, unknown> | undefined {
	if (text === undefined) return undefined;
	try {
		return recordOf(JSON.parse(text));
	} catch {
		return undefined;
	}
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
	return isObject(value) ? value : undefined;
}
