// What the app draws from elsewhere: one renderer for a model's answer, a tool's output and a diff.
export { Diff, diffLines, kindOf, type DiffLine, type DiffLineKind } from "./diff.tsx";
export { inline, Markdown, type MarkdownProps } from "./markdown.tsx";
export { plain, siteOf } from "./plain.ts";
