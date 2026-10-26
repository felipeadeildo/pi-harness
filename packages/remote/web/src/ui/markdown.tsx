// Never renders raw HTML, and a link shows its address only for http and https.
import { type ReactNode } from "react";

import { plain, siteOf } from "../session/plain.ts";

/** Paragraphs, headings, lists and code. */
export function Markdown({ text }: { text: string }): ReactNode {
	const lines = plain(text).split("\n");
	const blocks: ReactNode[] = [];
	let at = 0;

	while (at < lines.length) {
		const line = lines[at] ?? "";
		const heading = /^(#{1,6})\s+(.*)$/.exec(line);
		const item = /^[-*]\s+(.*)$/.exec(line);

		if (/^```\w*\s*$/.test(line)) {
			const body: string[] = [];
			at += 1;
			while (at < lines.length && !/^```\s*$/.test(lines[at] ?? "")) {
				body.push(lines[at] ?? "");
				at += 1;
			}
			at += 1;
			blocks.push(
				<pre key={`c${blocks.length}`} className="remote-code">
					<code>{body.join("\n")}</code>
				</pre>,
			);
			continue;
		}
		if (heading !== null) {
			const Tag = `h${Math.min(heading[1]?.length ?? 1, 6)}` as "h1";
			blocks.push(<Tag key={`h${blocks.length}`}>{inline(heading[2] ?? "")}</Tag>);
			at += 1;
			continue;
		}
		if (item !== null) {
			const items: ReactNode[] = [];
			while (at < lines.length) {
				const next = /^[-*]\s+(.*)$/.exec(lines[at] ?? "");
				if (next === null) break;
				items.push(<li key={`i${items.length}`}>{inline(next[1] ?? "")}</li>);
				at += 1;
			}
			blocks.push(<ul key={`u${blocks.length}`}>{items}</ul>);
			continue;
		}
		if (line.trim() === "") {
			at += 1;
			continue;
		}
		const paragraph: string[] = [];
		while (at < lines.length) {
			const next = lines[at] ?? "";
			if (next.trim() === "" || /^```\w*\s*$/.test(next) || /^#{1,6}\s+/.test(next)) break;
			if (/^[-*]\s+/.test(next)) break;
			paragraph.push(next);
			at += 1;
		}
		blocks.push(<p key={`p${blocks.length}`}>{inline(paragraph.join(" "))}</p>);
	}

	return <div className="remote-markdown">{blocks}</div>;
}

function inline(text: string): ReactNode[] {
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
		key += 1;

		if (whole.startsWith("`")) nodes.push(<code key={key}>{whole.slice(1, -1)}</code>);
		else if (whole.startsWith("**")) nodes.push(<strong key={key}>{whole.slice(2, -2)}</strong>);
		else if (whole.startsWith("*")) nodes.push(<em key={key}>{whole.slice(1, -1)}</em>);
		else if (whole.startsWith("![")) {
			// A remote picture is not loaded; the page names where it is.
			const site = siteOf(whole.slice(whole.indexOf("](") + 2, -1));
			nodes.push(
				<span key={key} className="remote-image">
					image: {site ?? "unknown"}
				</span>,
			);
		} else nodes.push(link(whole, key));
	}
	if (at < text.length) nodes.push(text.slice(at));
	return nodes;
}

/** The address shows only for a site a browser may open. */
function link(text: string, key: number): ReactNode {
	const [label = "", url = ""] = text.slice(1, -1).split("](");
	const site = siteOf(url);
	if (site === undefined) return <span key={key}>{label}</span>;
	const scheme = url.startsWith("https:") ? "https" : "http";
	return (
		<span key={key} className="remote-link">
			{label}
			<span className="dim"> ({`${scheme}://${site}`})</span>
		</span>
	);
}
