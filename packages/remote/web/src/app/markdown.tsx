// The model's markdown, GitHub-flavored, with its code highlighted. Raw HTML is never rendered, and a
// link opens only for http and https.
import { createContext, lazy, memo, type ReactNode, Suspense, useContext } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { plain, siteOf } from "@/session/plain.ts";

import { Code } from "./code.tsx";
import { SkillChip } from "./skill-chip.tsx";

const Mermaid = lazy(async () => ({ default: (await import("./mermaid.tsx")).Mermaid }));

/** A diagram still being written does not parse, so it shows as code until the answer ends. */
const Streaming = createContext(false);

function Fenced({ code, language }: { code: string; language: string }): ReactNode {
	const streaming = useContext(Streaming);
	if (language === "mermaid")
		return (
			<Suspense fallback={<Code code={code} language="text" size="sm" />}>
				<Mermaid code={code} streaming={streaming} />
			</Suspense>
		);
	return <Code code={code} language={language} />;
}

const components: Components = {
	pre: ({ children }) => <>{children}</>,
	code: ({ className, children }) => {
		const text = String(children ?? "");
		const language = /language-(\w+)/.exec(className ?? "")?.[1];
		if (language === undefined && !text.includes("\n")) {
			const skill = /^\/skill:([\w.-]+)$/.exec(text)?.[1];
			return skill === undefined ? <code>{children}</code> : <SkillChip name={skill} />;
		}
		return <Fenced code={text.replace(/\n$/, "")} language={language ?? "text"} />;
	},
	a: ({ href, children }) => {
		if (href === undefined || siteOf(href) === undefined) return <span>{children}</span>;
		return (
			<a href={href} target="_blank" rel="noreferrer noopener">
				{children}
			</a>
		);
	},
	table: ({ children }) => (
		<div className="-mx-1 max-w-full overflow-x-auto px-1">
			<table className="w-full border-collapse text-[0.92em]">{children}</table>
		</div>
	),
	th: ({ children }) => (
		<th className="border-b border-border px-2 py-1.5 text-left font-semibold">{children}</th>
	),
	td: ({ children }) => (
		<td className="border-b border-border/60 px-2 py-1.5 align-top">{children}</td>
	),
	img: () => null,
};

/** A `/skill:name` in prose reads as the skill's chip; the markdown carries it as inline code. */
function marked(text: string): string {
	return text.replace(/(^|[\s(])\/skill:([\w.-]+)/g, "$1`/skill:$2`");
}

export const Markdown = memo(function Markdown({
	text,
	streaming = false,
}: {
	text: string;
	streaming?: boolean;
}): ReactNode {
	return (
		<Streaming.Provider value={streaming}>
			<div className="prose-pi">
				<ReactMarkdown remarkPlugins={[remarkGfm]} components={components} skipHtml>
					{marked(plain(text))}
				</ReactMarkdown>
			</div>
		</Streaming.Provider>
	);
});
