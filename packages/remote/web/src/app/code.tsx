// Code as the page shows it: highlighted by Shiki when the language is known, plain otherwise, and
// always with a copy button.
import { cn } from "cn";
import { type ReactNode, useLayoutEffect, useRef } from "react";

import {
	CodeBlock,
	CodeBlockActions,
	CodeBlockContent,
	CodeBlockCopyButton,
	CodeBlockHeader,
	CodeBlockLine,
	CodeBlockTitle,
} from "@/components/ui/code-block";
import { useHighlightedCode } from "@/hooks/use-highlighted-code";
import { colored, plain } from "@/session/plain.ts";

const EXTENSIONS: Record<string, string> = {
	ts: "typescript",
	mts: "typescript",
	cts: "typescript",
	tsx: "tsx",
	js: "javascript",
	mjs: "javascript",
	cjs: "javascript",
	jsx: "jsx",
	json: "json",
	jsonc: "json",
	md: "markdown",
	py: "python",
	sh: "bash",
	bash: "bash",
	zsh: "bash",
	css: "css",
	html: "html",
	sql: "sql",
	yml: "yaml",
	yaml: "yaml",
	diff: "diff",
	patch: "diff",
};

export function languageOfPath(path: string): string {
	const extension = path.split(".").at(-1)?.toLowerCase() ?? "";
	return EXTENSIONS[extension] ?? "text";
}

/** Lines of highlighted code; plain until the grammar loads. */
function Highlighted({ code, language }: { code: string; language: string }): ReactNode {
	const lines = useHighlightedCode(code, language);
	return lines.map((line, index) => <CodeBlockLine key={index}>{line}</CodeBlockLine>);
}

export function Code({
	code,
	language = "text",
	title,
	size = "default",
	numbered = false,
	startLine,
	maxHeight = "max-h-96",
	variant = "default",
	className,
	follow = false,
}: {
	code: string;
	language?: string;
	title?: ReactNode;
	size?: "default" | "sm";
	numbered?: boolean;
	startLine?: number;
	maxHeight?: string;
	variant?: "default" | "destructive";
	className?: string;
	/** Keeps the end in view while the code is still being written. */
	follow?: boolean;
}): ReactNode {
	const content = useRef<HTMLPreElement>(null);
	const text = language === "ansi" ? colored(code) : plain(code);
	const known = language !== "text" && language !== "";
	useLayoutEffect(() => {
		const box = content.current;
		if (follow && box !== null) box.scrollTop = box.scrollHeight;
	});
	return (
		<CodeBlock size={size} variant={variant} className={cn("bg-raised", className)}>
			{title === undefined ? (
				<CodeBlockActions>
					<CodeBlockCopyButton value={text} />
				</CodeBlockActions>
			) : (
				<CodeBlockHeader>
					<CodeBlockTitle className="font-mono font-normal">{title}</CodeBlockTitle>
					<CodeBlockActions>
						<CodeBlockCopyButton value={text} />
					</CodeBlockActions>
				</CodeBlockHeader>
			)}
			<CodeBlockContent
				ref={content}
				wrap
				lineNumbers={numbered}
				{...(startLine === undefined ? {} : { startLine })}
				className={maxHeight}
			>
				{known ? <Highlighted code={text} language={language} /> : text}
			</CodeBlockContent>
		</CodeBlock>
	);
}
