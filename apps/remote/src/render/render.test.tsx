// What a session writes is drawn, never interpreted. These tests pin the four ways text from
// elsewhere usually gets a screen into trouble: a tag, a link that runs, a picture that loads, and
// the terminal's escape sequences.
import { describe, expect, test } from "bun:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Diff, diffLines, kindOf } from "./diff.tsx";
import { Markdown } from "./markdown.tsx";
import { plain, siteOf } from "./plain.ts";

const draw = (text: string): string => renderToStaticMarkup(createElement(Markdown, { text }));
const drawDiff = (text: string): string => renderToStaticMarkup(createElement(Diff, { text }));

describe("text from elsewhere", () => {
	test("a tag is the characters a model wrote, not a tag", () => {
		const html = draw('<script>alert("x")</script> and <img src="x" onerror="y">');
		expect(html).not.toContain("<script");
		expect(html).not.toContain("<img");
		expect(html).toContain("&lt;script&gt;");
	});

	test("a link that is not http or https stays words, without its address", () => {
		const html = draw("[click](javascript:alert(1)) and [also](data:text/html,x)");
		expect(html).not.toContain("javascript:");
		expect(html).not.toContain("data:text/html");
		expect(html).toContain("click");
	});

	test("a remote picture becomes a line with where it lives, and is never loaded", () => {
		const html = draw("![a chart](https://example.com/chart.png?token=secret)");
		expect(html).not.toContain("<img");
		expect(html).not.toContain("token=secret");
		expect(html).toContain("image: example.com");
	});

	test("a link names its domain next to the words", () => {
		const html = draw("see [the docs](https://example.com/a/b?c=1)");
		expect(html).toContain("the docs");
		expect(html).toContain("example.com");
		expect(html).toContain("https");
	});

	test("the terminal's escape sequences never reach the screen", () => {
		const text = "\u001b[31mred\u001b[0m and \u001b]0;title\u0007 after";
		expect(plain(text)).toBe("red and  after");
		expect(plain("\u009b2Jcleared")).toBe("2Jcleared");
		expect(draw(text)).not.toContain("\u001b");
		expect(draw("\u009b2Jcleared")).not.toContain("\u009b");
	});

	test("paragraphs, headings, lists and fenced code are drawn as what they are", () => {
		const html = draw("# Title\n\n- one\n- two\n\n```sh\nls -la\n```");
		expect(html).toContain("<h1>Title</h1>");
		expect(html).toContain("<li>one</li>");
		expect(html).toContain("<pre");
		expect(html).toContain("ls -la");
	});

	test("a code block keeps its text exactly, escapes and all", () => {
		const html = draw("```\n<p>&\n```");
		expect(html).toContain("&lt;p&gt;&amp;");
	});
});

describe("a diff", () => {
	test("reads its lines by the mark the diff already carries", () => {
		expect(kindOf("+++ b/file.ts")).toBe("file");
		expect(kindOf("@@ -1,2 +1,2 @@")).toBe("hunk");
		expect(kindOf("+added")).toBe("added");
		expect(kindOf("-removed")).toBe("removed");
		expect(kindOf(" context")).toBe("context");
	});

	test("draws one row per line, with the mark kept out of the words", () => {
		const html = drawDiff("@@ -1 +1 @@\n-old\n+new");
		expect(html).toContain("remote-diff-added");
		expect(html).toContain("remote-diff-removed");
		expect(html).toContain("remote-diff-hunk");
		expect(html).toContain("new");
	});

	test("a diff in a terminal is stripped like everything else", () => {
		expect(diffLines("\u001b[32m+green\u001b[0m")[0]?.text).toBe("+green");
	});
});

describe("where a link points", () => {
	test("only http and https have a site", () => {
		expect(siteOf("https://example.com/a")).toBe("example.com");
		expect(siteOf("http://example.com:8080/a")).toBe("example.com:8080");
		expect(siteOf("file:///etc/passwd")).toBeUndefined();
		expect(siteOf("javascript:alert(1)")).toBeUndefined();
		expect(siteOf("not a url")).toBeUndefined();
	});
});
