/**
 * What a diagram still being written can show: the longest run of its first lines that draws. A
 * block whose fence has not closed drops its last line, which may be cut in the middle of a word.
 * Only runs longer than `above` lines are tried, so a stream asks again only for the lines it added.
 */
export function longestDrawable<T>(
	source: string,
	complete: boolean,
	draw: (text: string) => T,
	above = 1,
): { drawn: T; text: string; lines: number } | undefined {
	const lines = source.split("\n");
	if (!complete) lines.pop();
	for (let count = lines.length; count > above; count--) {
		const text = lines.slice(0, count).join("\n");
		try {
			return { drawn: draw(text), text, lines: count };
		} catch {
			// This run does not parse yet; a shorter one may.
		}
	}
	return undefined;
}
