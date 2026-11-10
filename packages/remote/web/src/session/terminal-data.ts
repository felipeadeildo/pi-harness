// What the terminal screen decides apart from drawing: its address, how a close reads, and the
// bytes the phone's key bar sends.

export function terminalHref(machine: string, name: string): string {
	return `/terminal/${encodeURIComponent(machine)}/${encodeURIComponent(name)}`;
}

export function terminalSocketUrl(
	location: { protocol: string; host: string },
	machine: string,
	name: string,
	size: { cols: number; rows: number },
): string {
	const scheme = location.protocol === "https:" ? "wss" : "ws";
	const query = new URLSearchParams({
		machine,
		name,
		cols: String(size.cols),
		rows: String(size.rows),
	});
	return `${scheme}://${location.host}/terminal?${query}`;
}

/** The daemon closes with 1000 when the shell ended, and with 4000 plus a status when it refused. */
export type Closed =
	| { kind: "ended"; text: string }
	| { kind: "refused"; text: string; status: number }
	| { kind: "lost" };

export function closedOf(code: number, reason: string): Closed {
	if (code === 1000) return { kind: "ended", text: sentence(reason || "the shell ended") };
	if (code >= 4000 && code < 5000)
		return { kind: "refused", status: code - 4000, text: sentence(reason || "the daemon refused") };
	return { kind: "lost" };
}

/** Waits a little longer after each lost connection, up to ten seconds. */
export function retryAfter(attempt: number): number {
	return Math.min(10_000, 500 * 2 ** attempt);
}

export type BarKey = "esc" | "tab" | "up" | "down" | "left" | "right";

/** An arrow follows the terminal's cursor-key mode, as a real keyboard's does. */
export function keyBytes(key: BarKey, applicationCursor: boolean): string {
	const arrow = (letter: string) => (applicationCursor ? `\x1bO${letter}` : `\x1b[${letter}`);
	switch (key) {
		case "esc":
			return "\x1b";
		case "tab":
			return "\t";
		case "up":
			return arrow("A");
		case "down":
			return arrow("B");
		case "right":
			return arrow("C");
		case "left":
			return arrow("D");
	}
}

/** Ctrl held on the bar turns the next letter into its control character; anything else passes. */
export function withCtrl(data: string): string {
	if (data.length !== 1) return data;
	const code = data.toLowerCase().charCodeAt(0);
	if (code >= 97 && code <= 122) return String.fromCharCode(code - 96);
	if (data === "[") return "\x1b";
	if (data === " ") return "\x00";
	return data;
}

function sentence(text: string): string {
	const first = text.charAt(0).toUpperCase() + text.slice(1);
	return first.endsWith(".") ? first : `${first}.`;
}
