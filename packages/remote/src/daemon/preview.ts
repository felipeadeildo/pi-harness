// The daemon's own HTTP server, serving a web export and nothing else, for the app's browser check.
// The check then loads the app through the same routes, list and policy as a real daemon, instead of
// a copy of them that could drift.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadWebApp, packageWeb } from "./app.ts";
import { Logins } from "./auth.ts";
import { Clients } from "./clients.ts";
import { Sessions } from "./sessions.ts";

export interface Preview {
	url: string;
	stop(): void;
}

/** Serves the export in `exported` on a free loopback port, with no session and no socket. */
export async function serveExport(exported: string): Promise<Preview> {
	const out = mkdtempSync(join(tmpdir(), "pi-remote-preview-"));
	packageWeb(exported, out);
	const web = loadWebApp(join(out, "web"));
	if (web === undefined) throw new Error(`nothing to serve in ${exported}`);
	const clients = new Clients({
		sessions: new Sessions(),
		// The preview serves the export and the open routes only: no login is traded there, and every
		// data route would answer 401 without a cookie.
		logins: new Logins(join(out, "logins.json")),
		version: "preview",
		// A preview has no session behind it, so a command answers that nothing can take it.
		command: () => false,
		web,
	});
	const listened = await clients.listen(0);
	if ("why" in listened) throw new Error(`the preview found no port to listen on: ${listened.why}`);
	return {
		url: `http://127.0.0.1:${listened.port}/`,
		stop: () => {
			clients.close();
			rmSync(out, { recursive: true, force: true });
		},
	};
}
