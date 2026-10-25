// The remote's own settings: what the operator changes without reading code. They live beside the
// extension because the daemon is the one that listens, and the bridge is the one that starts it.
import { type Decoder, integer, setting } from "@adeildo/pi-kit";

import { CLIENT_PORT, PORT_ID } from "./places.ts";

const REMOTE_SECTION = "Remote";

/**
 * The port clients reach the daemon on. It is a setting and not a flag because the address a phone or
 * an installed web app remembers has to stay the same across restarts, and because a port already
 * taken by another program is a fault the operator has to be able to fix without a shell.
 */
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
