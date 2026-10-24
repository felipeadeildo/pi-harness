// The one renderer for text that comes from somewhere else: a model's answer, a tool's output, a
// diff. It is written against the DOM, so the native app can host it as a DOM component later, and
// it builds nodes with `createElement` instead of JSX, because a `.tsx` here would need the app's
// React Native types to know what a `div` is.
//
// It never renders raw HTML. What looks like a tag comes out as text, so `<script>` is the eight
// characters a model wrote, and a link only becomes a link when it is http or https.
import { type ReactNode, createElement as h } from "react";

import { plain, siteOf } from "./plain.ts";

export interface MarkdownProps {
	/** What to draw, as the model or a tool wrote it. */
	text: string;
	/** The colour of a link's domain, which the app sets once. */
	dim?: string;
}

/** Draws the subset of markdown a session writes: paragraphs, headings, lists, code and diffs. */
export function Markdown({ text, dim }: MarkdownProps): ReactNode {
	const lines = plain(text).split("\n");
	const blocks: ReactNode[] = [];
	let at = 0;

	while (at < lines.length) {
		const line = lines[at] ?? "";
		const fenced = /^```\w*\s*$/.test(line);
		const heading = /^(#{1,6})\s+(.*)$/.exec(line);
		const item = /^[-*]\s+(.*)$/.exec(line);

		if (fenced) {
			const body: string[] = [];
			at += 1;
			while (at < lines.length && !/^```\s*$/.test(lines[at] ?? "")) {
				body.push(lines[at] ?? "");
				at += 1;
			}
			at += 1;
			blocks.push(
				h(
					"pre",
					{ key: `c${blocks.length}`, className: "remote-code" },
					h("code", undefined, body.join("\n")),
				),
			);
			continue;
		}
		if (heading !== null) {
			const level = Math.min(heading[1]?.length ?? 1, 6);
			blocks.push(h(`h${level}`, { key: `h${blocks.length}` }, ...inline(heading[2] ?? "", dim)));
			at += 1;
			continue;
		}
		if (item !== null) {
			const items: ReactNode[] = [];
			while (at < lines.length) {
				const next = /^[-*]\s+(.*)$/.exec(lines[at] ?? "");
				if (next === null) break;
				items.push(h("li", { key: `i${items.length}` }, ...inline(next[1] ?? "", dim)));
				at += 1;
			}
			blocks.push(h("ul", { key: `u${blocks.length}` }, ...items));
			continue;
		}
		if (line.trim() === "") {
			at += 1;
			continue;
		}
		const paragraph: string[] = [];
		while (at < lines.length) {
			const next = lines[at] ?? "";
			if (next.trim() === "" || /^```\w*\s*$/.test(next) || /^(#{1,6})\s+/.test(next)) break;
			if (/^[-*]\s+/.test(next)) break;
			paragraph.push(next);
			at += 1;
		}
		blocks.push(h("p", { key: `p${blocks.length}` }, ...inline(paragraph.join(" "), dim)));
	}

	return h("div", { className: "remote-markdown" }, ...blocks);
}

/** The inline marks: code, bold, italic, links and images, in the order they open. */
export function inline(text: string, dim?: string): ReactNode[] {
	const nodes: ReactNode[] = [];
	const pattern =
		/(`[^`]*`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(!\[[^\]]*\]\([^)\s]+\))|(\[[^\]]*\]\([^)\s]+\))/g;
	let at = 0;
	let key = 0;

	for (const match of text.matchAll(pattern)) {
		const index = match.index ?? 0;
		if (index > at) nodes.push(text.slice(at, index));
		const whole = match[0];
		at = index + whole.length;

		if (whole.startsWith("`")) {
			nodes.push(h("code", { key: `k${key++}` }, whole.slice(1, -1)));
		} else if (whole.startsWith("**")) {
			nodes.push(h("strong", { key: `s${key++}` }, whole.slice(2, -2)));
		} else if (whole.startsWith("*")) {
			nodes.push(h("em", { key: `e${key++}` }, whole.slice(1, -1)));
		} else if (whole.startsWith("![")) {
			// A remote picture is not loaded: the app says where it is, and nothing else happens.
			const site = siteOf(addressOf(whole));
			nodes.push(
				h("span", { key: `m${key++}`, className: "remote-image" }, `image: ${site ?? "unknown"}`),
			);
		} else {
			nodes.push(...linkNodes(whole, key, dim));
			key += 2;
		}
	}
	if (at < text.length) nodes.push(text.slice(at));
	return nodes;
}

/** `[label](url)` as the words, and the address only when it is a site a browser may open. */
function linkNodes(text: string, key: number, dim?: string): ReactNode[] {
	const [label = "", url = ""] = text.slice(1, -1).split("](");
	const site = siteOf(url);
	if (site === undefined) return [h("span", { key: `t${key}` }, label)];
	const scheme = url.startsWith("https:") ? "https" : "http";
	return [
		h(
			"span",
			{ key: `l${key}`, className: "remote-link" },
			label,
			h(
				"span",
				{ key: `d${key + 1}`, style: dim === undefined ? undefined : { color: dim } },
				` (${scheme}://${site})`,
			),
		),
	];
}

/** The address in `![alt](url)`, which is everything after the `](` and before the last `)`. */
function addressOf(text: string): string {
	const open = text.indexOf("](");
	return open === -1 ? "" : text.slice(open + 2, -1);
}
