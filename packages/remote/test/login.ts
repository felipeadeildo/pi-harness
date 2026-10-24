// A login the way the web app gets one: a token the daemon issued, traded at `POST /login` for the
// cookie that every request but the app's own files needs.
import type { Daemon } from "../src/daemon/server.ts";

/** Trades a token the daemon issued for its login cookie, as the web app does with `/remote`'s link. */
export async function logIn(daemon: Daemon, port: number): Promise<string> {
	const response = await fetch(`http://127.0.0.1:${port}/login`, {
		method: "POST",
		headers: { Origin: `http://127.0.0.1:${port}`, "content-type": "application/json" },
		body: JSON.stringify({ token: daemon.logins.issue().token }),
	});
	const cookie = response.headers.get("set-cookie")?.split(";")[0];
	if (response.status !== 204 || cookie === undefined) throw new Error("no login");
	return cookie;
}
