// Strips terminal escape sequences from text that came from elsewhere.

// CSI, OSC and the two-character escapes, including the OSC terminator that carries a command.
// eslint-disable-next-line no-control-regex -- the control characters are the thing being removed.
const ESCAPES = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)|[@-Z\\-_])/g;

export function plain(text: string): string {
	return (
		text
			.replace(ESCAPES, "")
			.replace(/\r\n?/g, "\n")
			// eslint-disable-next-line no-control-regex -- the control characters are the thing being removed.
			.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, "")
	);
}

/** Like `plain`, but keeps the color codes (SGR), for output a highlighter reads as ANSI. */
export function colored(text: string): string {
	const kept: string[] = [];
	// A private-use character survives `plain`, so it holds each color code's place.
	const marked = text.replace(
		// eslint-disable-next-line no-control-regex -- the escape is what is kept.
		/\u001b\[[0-9;]*m/g,
		(code) => `\u{E000}${kept.push(code) - 1}\u{E000}`,
	);
	return plain(marked).replace(
		/\u{E000}(\d+)\u{E000}/gu,
		(_, index: string) => kept[Number(index)] ?? "",
	);
}

export function siteOf(url: string): string | undefined {
	try {
		const parsed = new URL(url);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
		return parsed.host;
	} catch {
		return undefined;
	}
}
