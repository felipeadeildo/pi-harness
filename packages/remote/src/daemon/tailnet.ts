// The machine's place on a tailnet, so a phone on it reaches the daemon with nothing to set up. Both
// answers come from the `tailscale` command: the machine's name and address once, when the daemon
// starts, and who another address belongs to, when a device asks to log in. A machine without
// Tailscale, or one where the command fails or is slow, reaches the daemon on loopback only.
import { execFile } from "node:child_process";

import { isObject } from "@adeildo/pi-remote-protocol";

/** How long the daemon waits on `tailscale` before it acts as if there were no tailnet. */
const ASK_MS = 2_000;

/** How long an answer about one address is kept, so a phone's requests do not each start a process. */
const KEPT_MS = 60_000;

/** The machine on its tailnet: the name a phone types, the address the daemon listens on, its owner. */
export interface Tailnet {
	/** The MagicDNS name, without the trailing dot. */
	name: string;
	/** The machine's IPv4 address on the tailnet. */
	ip: string;
	/** The tailnet user who owns this machine. */
	user: number;
}

/** Runs `tailscale` with these arguments, and gives its output, or nothing when it failed or was slow. */
export type AskTailscale = (args: readonly string[]) => Promise<string | undefined>;

const askTailscale: AskTailscale = (args) =>
	new Promise((resolve) => {
		execFile("tailscale", [...args], { timeout: ASK_MS }, (error, stdout) =>
			resolve(error === null ? stdout : undefined),
		);
	});

/** This machine on its tailnet, or nothing when it is not on one. */
export async function readTailnet(ask: AskTailscale = askTailscale): Promise<Tailnet | undefined> {
	return nodeOf(parsed(await ask(["status", "--json"]))?.Self);
}

/**
 * This machine on its tailnet and the owner's other machines that are online, each by its address.
 * A node another user shares into the tailnet is not one of them.
 */
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

/**
 * Whether an address on the tailnet belongs to the user who owns this machine: the operator's own
 * phone does, and a node another user shares into the tailnet does not. Anything that is not a clear
 * yes is a no, and the device logs in with a link instead.
 */
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
