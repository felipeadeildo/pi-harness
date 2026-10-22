import { describe, expect, test } from "bun:test";

import { constant, gates } from "../eval/claude-code/contract.ts";

describe("reading a header the registry spelled as a constant", () => {
	test("the name stands alone, so an HTML attribute ending in it does not count", () => {
		const source = `<link href="thumb.png">var c="x",ef="oauth-2025-04-20";REGISTRY`;
		expect(constant(source, "ef", source.indexOf("REGISTRY"))).toBe("oauth-2025-04-20");
	});

	test("a name the minifier reused takes the assignment nearest before the registry", () => {
		const source = `a="early-2024-01-01";b;a="oauth-2025-04-20";REGISTRY;a="late-2026-01-01"`;
		expect(constant(source, "a", source.indexOf("REGISTRY"))).toBe("oauth-2025-04-20");
	});

	test("one assigned only after the registry still resolves", () => {
		const source = `REGISTRY;a="oauth-2025-04-20"`;
		expect(constant(source, "a", 0)).toBe("oauth-2025-04-20");
	});
});

describe("reading the gate of a feature", () => {
	const scope = {
		name: "prompt_caching_scope",
		header: "prompt-caching-scope-2026-01-05",
		variable: "J",
	};
	const effort = { name: "effort", header: "effort-2025-11-24", variable: "E" };

	test("a predicate that only calls a function is read from the function's body", () => {
		// The second `D8` is another module's.
		const source = [
			`function D8(){if(!Qy())return!1;let e=Re();return e==="firstParty"||e==="anthropicAws"}`,
			`var W0=[{beta:J,when:()=>D8()},{beta:E,when:(e)=>e.vertex}];`,
			`function D8(e){return e?"1":"0"}`,
		].join("");
		const found = gates(source, [scope, effort]);
		expect(found.get(scope.header)).toBe("Anthropic's own API only.");
		expect(found.get(effort.header)).toBe("Vertex and Foundry only.");
	});

	test("a function with no known name in it leaves the gate out", () => {
		const source = `function D8(){return Qy()}var W0=[{beta:J,when:()=>D8()}];`;
		expect(gates(source, [scope]).has(scope.header)).toBe(false);
	});
});
