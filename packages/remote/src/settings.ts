// The remote's own settings: what the operator changes without reading code. They live beside the
// extension because the daemon is the one that listens, and the bridge is the one that starts it.
import { boolean, type Decoder, integer, setting } from "@adeildo/pi-kit";

import { CLIENT_PORT, PORT_ID } from "./places.ts";

const REMOTE_SECTION = "Remote";

/** A setting, not a flag: the address a phone remembers must survive restarts. */
const portRule: Decoder<number> = integer(1, 65_535);

export const port = setting<number>({
	id: PORT_ID,
	default: CLIENT_PORT,
	decoder: portRule,
	ui: {
		section: REMOTE_SECTION,
		label: "Port for clients",
		description:
			"The port the daemon listens on for phones and browsers, on 127.0.0.1. Change it when another program already holds the default: the link the remote gives you uses whatever is set here, and it takes effect when the daemon starts again.",
		restart: true,
	},
});

export const forwardOtherDialogs = setting<boolean>({
	id: "remote.forwardOtherDialogs",
	default: true,
	decoder: boolean,
	ui: {
		section: REMOTE_SECTION,
		label: "Answer other dialogs from clients",
		description:
			"In a terminal session, a select, confirm or input that pi or another extension opens also shows on your phone and browser, and the first answer wins. A text editor and a custom component stay in the terminal. Turn it off to keep them there.",
	},
});
