// What the app draws from elsewhere: one renderer for a model's answer, a tool's output and a diff.
export { diffLines, kindOf, type DiffLine, type DiffLineKind } from "./diff-lines.ts";
export { default as Diff } from "./diff.tsx";
export { default as Markdown } from "./markdown.tsx";
export { plain, siteOf } from "./plain.ts";
