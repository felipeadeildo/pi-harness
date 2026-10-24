// Opens a link in the operator's browser. `$BROWSER` wins, as most tools honor it, and then the
// platform's opener. It never waits and never throws: a machine with no browser, such as one reached
// over SSH, still shows the link, which is what the caller prints next.
import { spawn } from "node:child_process";

export function openInBrowser(
	url: string,
	env: NodeJS.ProcessEnv = process.env,
	platform: NodeJS.Platform = process.platform,
): void {
	try {
		const child = spawn(openerOf(env, platform), [url], { detached: true, stdio: "ignore" });
		child.on("error", () => {});
		child.unref();
	} catch {
		// A command that cannot even start leaves the printed link as the way in.
	}
}

function openerOf(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string {
	if (env.BROWSER !== undefined && env.BROWSER !== "") return env.BROWSER;
	return platform === "darwin" ? "open" : "xdg-open";
}
