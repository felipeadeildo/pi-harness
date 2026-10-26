// What reaches the screen from elsewhere, with nothing of the terminal in it. A session's text comes
// from a model, a tool, or another machine, so it is drawn, never interpreted.
//
// The escape sequences are the terminal's: colour, cursor moves, and the operating-system commands
// that a terminal would run. The app is not a terminal, and none of it should survive the trip.

// CSI, OSC and the two-character escapes, including the OSC terminator that carries a command.
// eslint-disable-next-line no-control-regex -- the control characters are the thing being removed.
const ESCAPES = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)|[@-Z\\-_])/g;

/** The text with the terminal's escape sequences and control characters taken out. */
export function plain(text: string): string {
	return (
		text
			.replace(ESCAPES, "")
			.replace(/\r\n?/g, "\n")
			// eslint-disable-next-line no-control-regex -- the control characters are the thing being removed.
			.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, "")
	);
}

/** Where a link or an image points, as the line under it names it. */
export function siteOf(url: string): string | undefined {
	try {
		const parsed = new URL(url);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
		return parsed.host;
	} catch {
		return undefined;
	}
}
