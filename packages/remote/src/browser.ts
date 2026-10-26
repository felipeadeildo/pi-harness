// Opens a link with `$BROWSER` or the platform's opener. Never waits and never throws: the caller
// prints the link anyway.
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
		// The printed link is still the way in.
	}
}

function openerOf(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string {
	if (env.BROWSER !== undefined && env.BROWSER !== "") return env.BROWSER;
	return platform === "darwin" ? "open" : "xdg-open";
}
