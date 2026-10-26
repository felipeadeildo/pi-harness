import {
	AUTO_MODEL,
	type Decoder,
	fail,
	integer,
	literal,
	modelChoice,
	pass,
	problem,
	type RoomMode,
	setting,
	string,
} from "@adeildo/pi-kit";

import { BUSY_DELIVERIES, type BusyDelivery, CHAIN_LIMIT } from "./rules.ts";

const SETTINGS_SECTION = "Requests to everyone";

export const model = setting({
	id: "peers.model",
	default: AUTO_MODEL,
	decoder: string,
	ui: {
		section: SETTINGS_SECTION,
		label: "Model",
		description:
			"The model that bids for this session when you ask everyone. It reads what the session does, never the agent's conversation.",
		control: modelChoice,
	},
});

export const delivery = setting<BusyDelivery>({
	id: "peers.delivery",
	default: "steered",
	decoder: literal(...BUSY_DELIVERIES),
	ui: {
		section: SETTINGS_SECTION,
		label: "While it runs",
		description:
			"How a colleague's message reaches your agent while its run is going. Between calls attaches it at the end of what it is doing now, the way your own steer does; after the run waits for the turn to end; the next prompt never interrupts. A message marked urgent always attaches between calls.",
		control: {
			type: "choice",
			options: [
				{ value: "steered", label: "between calls" },
				{ value: "after-run", label: "after its run" },
				{ value: "next-turn", label: "with your next prompt" },
			],
		},
	},
});

export const chainLimit = setting<number>({
	id: "peers.chainLimit",
	default: CHAIN_LIMIT,
	decoder: integer(0, 1000),
	ui: {
		section: SETTINGS_SECTION,
		label: "Replies before a loop stops",
		description:
			"Agents that answer each other keep waking each other without asking you. After this many replies in a row with no prompt from you, it reads as a loop: the next message waits for your prompt, and your chat says why. 0 never stops them.",
	},
});

const ROOMS_SECTION = "Rooms";

export type LinkRule = "mode" | "ask" | "never";

export const link = setting<LinkRule>({
	id: "peers.link",
	default: "mode",
	decoder: literal("mode", "ask", "never"),
	ui: {
		section: ROOMS_SECTION,
		label: "When an agent asks for a room",
		description:
			"An agent can ask to talk to the sessions open in another folder. The permission mode decides it like any call: you answer the dialog, or the judge does by your policy. Always ask me brings the dialog in every mode, full included. Only me refuses, and the agent asks you to link it from Alt+G.",
		control: {
			type: "choice",
			options: [
				{ value: "mode", label: "the permission mode decides" },
				{ value: "ask", label: "always ask me" },
				{ value: "never", label: "only me" },
			],
		},
	},
});

const seconds: Decoder<number> = {
	control: { type: "number", min: 0, step: 5, unit: "s" },
	decode(input, path) {
		if (typeof input !== "number" || !Number.isInteger(input) || input < 0)
			return fail(problem(path, "expected a whole number of seconds, zero or more"));
		return pass(input);
	},
};

export const roomGrace = setting<number>({
	id: "peers.roomGrace",
	default: 30,
	decoder: seconds,
	ui: {
		section: ROOMS_SECTION,
		label: "Room grace",
		description:
			"How long a shared room waits after a folder's last agent closes. Then the folder leaves, and a room whose open agents are all in one folder closes. A reload or a restart shorter than this keeps the room.",
	},
});

export const opening = setting<Exclude<RoomMode, "out">>({
	id: "peers.opening",
	default: "in",
	decoder: literal("in", "listening"),
	ui: {
		section: ROOMS_SECTION,
		label: "When a room takes you in",
		description:
			"A session added to a room takes part: what is said there reaches it and it can take a request to everyone. A session that listens hears only what names it, and never takes a request it was not called to. Either way `m` in the rooms list switches, room by room.",
		control: {
			type: "choice",
			options: [
				{ value: "in", label: "takes part" },
				{ value: "listening", label: "just listens" },
			],
		},
	},
});

export const PEERS_SETTINGS = [delivery, chainLimit, model, link, roomGrace, opening];
