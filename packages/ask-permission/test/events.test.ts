import { describe, expect, test } from "bun:test";

import { ANSWER, ASK, type AskRequest, type AskResult, AVAILABLE } from "@adeildo/pi-kit";
import { fakePi, fakeScope, toolInfo } from "@adeildo/pi-kit/testing";
import {
	createEventBus,
	type EventBus,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";

import { AlwaysYes, SCOPE_LABEL } from "#core/always-yes.ts";
import type { DialogAnswer } from "#core/answer.ts";
import { defaultConfig } from "#core/config/schema.ts";
import type { OutsideScope } from "#core/config/schema.ts";
import { OpenFolders } from "#core/folders.ts";
import type { PermissionMode } from "#core/mode.ts";
import { DECIDED_EVENT } from "#pi/api.ts";
import { registerEvents } from "#pi/events.ts";
import type { SessionState } from "#pi/session.ts";

/**
 * An alwaysAsk rule makes the judge answer without a backend, so these
 * tests exercise the real `runJudge` path with no network or API key.
 */
function judgeThatAsks(): SessionState["config"] {
	const config = defaultConfig();
	return { ...config, judge: { ...config.judge, alwaysAsk: ["*"] } };
}

function harness(mode: PermissionMode = "manual", outside: OutsideScope = "ask", bus?: EventBus) {
	const decided: unknown[] = [];
	const fake = fakePi(bus);
	fake.pi.events.on(DECIDED_EVENT, (data: unknown) => decided.push(data));

	const state = {
		config: { ...judgeThatAsks(), workspace: { roots: ["."], outside } },
		mode,
		outside,
		alwaysYes: new AlwaysYes(),
		folders: new OpenFolders(),
		customTools: new Map(),
		pendingWrites: new Map(),
		pendingNotes: new Map<string, string>(),
		judgeCache: new Map(),
		judgeLog: [],
		judgeWarned: new Set<string>(),
		judgeHealth: { failures: 0, retryAt: 0 },
		rulings: new Map(),
		redraws: new Map(),
		prejudged: new Map(),
		typing: {
			start: () => {},
			stop: () => {},
			pause: () => {},
			resume: () => {},
			waitUntilQuiet: async () => {},
		},
	} as unknown as SessionState;

	registerEvents(fakeScope({ pi: fake }), state);

	const messageEnd = fake.handlers.get("message_end")?.[0];
	const toolCall = fake.handlers.get("tool_call")?.[0];
	if (!toolCall) throw new Error("no tool_call handler");

	const entries = fake.entries;
	const rulings = () => entries.filter((entry) => entry.customType === "pi-ask-permission:ruling");
	return { entries, rulings, decided, state, toolCall, messageEnd, fake };
}

/** The label of `answer` among the choices of the host's selector, or undefined for a dismissal. */
function choiceFor(labels: string[], answer: DialogAnswer): string | undefined {
	if (answer.open) return labels.find((label) => /yes, and (allow reads in|add) /.test(label));
	if (answer.decision === "deny") return labels.find((label) => label.endsWith(". deny"));
	if (answer.remember !== undefined) return labels.find((label) => label.endsWith(". always yes"));
	return labels.find((label) => /^\d+\. yes$/.test(label));
}

/**
 * A context whose host answers through its own selector, which is where the gate asks when no
 * questions feature draws the dialog. `onDialog` runs when the question opens, before it is
 * answered, and receives the choices it shows.
 */
function fakeContext(
	onDialog: (labels: string[]) => void = () => {},
	answer: DialogAnswer = { decision: "allow" },
): ExtensionContext {
	return {
		mode: "tui",
		hasUI: true,
		cwd: "/repo",
		signal: undefined,
		modelRegistry: {},
		sessionManager: { getBranch: () => [] },
		ui: {
			theme: { fg: (_color: string, text: string) => text },
			notify: () => {},
			setStatus: () => {},
			input: async () => undefined,
			select: async (title: string, labels: string[]) => {
				if (title.startsWith("Allow ")) {
					onDialog(labels);
					return choiceFor(labels, answer);
				}
				if (title === "Always yes for...") return answer.remember;
				return answer.scope === undefined ? undefined : SCOPE_LABEL[answer.scope];
			},
		},
	} as unknown as ExtensionContext;
}

function judgeCall(id: string, command: string) {
	return { toolName: "bash", toolCallId: id, input: { command } };
}

function writeCall(id: string, path = "a.ts") {
	return { toolName: "write", toolCallId: id, input: { path, content: "x" } };
}

describe("the ruling on each call", () => {
	test("the call says why it asks while the dialog is open", async () => {
		const { state, toolCall } = harness("judge");
		let shown: unknown;

		await toolCall(
			judgeCall("call-1", "git push origin main"),
			fakeContext(() => {
				shown = state.rulings.get("call-1");
			}),
		);

		expect(shown).toMatchObject({ head: "asking you", why: "it matches judge.alwaysAsk" });
	});

	test("each call keeps its own answer, with why it was asked", async () => {
		const { rulings, toolCall } = harness("judge");

		await toolCall(judgeCall("call-1", "git push origin main"), fakeContext());
		await toolCall(
			judgeCall("call-2", "git push --force origin main"),
			fakeContext(() => {}, { decision: "deny" }),
		);

		expect(rulings().map((entry) => entry.data)).toEqual([
			expect.objectContaining({
				toolCallId: "call-1",
				head: "you approved",
				why: "asked because it matches judge.alwaysAsk",
			}),
			expect.objectContaining({ toolCallId: "call-2", head: "you said no" }),
		]);
	});

	test("the calls of one answer are judged together, once each", async () => {
		const { state, toolCall, messageEnd } = harness("judge");
		const calls = [judgeCall("call-1", "git push origin main"), judgeCall("call-2", "npm publish")];
		const message = {
			role: "assistant",
			content: calls.map((call) => ({
				type: "toolCall",
				id: call.toolCallId,
				name: call.toolName,
				arguments: call.input,
			})),
		};

		await messageEnd?.({ type: "message_end", message }, fakeContext());
		await Promise.all([...state.prejudged.values()].map((entry) => entry.verdict));
		expect(state.judgeLog).toHaveLength(2);
		expect(state.rulings.get("call-2")).toMatchObject({ why: "it matches judge.alwaysAsk" });

		// oxlint-disable-next-line no-await-in-loop -- pi asks about the calls one at a time
		for (const call of calls) await toolCall(call, fakeContext());
		expect(state.judgeLog).toHaveLength(2);
	});

	test("a call a rule lets through says nothing", async () => {
		const { rulings, toolCall } = harness("full");
		await toolCall(judgeCall("call-1", "git status"), fakeContext());
		expect(rulings()).toEqual([]);
	});
});

/** A questions feature in the same process: it says it is there, and answers with `script`. */
function questionsProvider(script: AskResult[]): { bus: EventBus; asked: AskRequest[] } {
	const bus = createEventBus();
	const asked: AskRequest[] = [];
	bus.on(AVAILABLE, (data: unknown) => void ((data as { available: boolean }).available = true));
	bus.on(ASK, (data: unknown) => {
		const request = data as AskRequest;
		asked.push(request);
		bus.emit(ANSWER, {
			id: request.id,
			result: script.shift() ?? { answers: [], cancelled: true },
		});
	});
	return { bus, asked };
}

function answerTo(picked: string): AskResult {
	return {
		answers: [{ question: "q", header: "permission", picked: [picked], notes: [] }],
		cancelled: false,
	};
}

describe("one dialog for the permission and the questions", () => {
	test("the gate asks there, and the old dialog never opens", async () => {
		const { bus, asked } = questionsProvider([answerTo("yes")]);
		const { toolCall } = harness("judge", "ask", bus);
		let opened = 0;

		await toolCall(
			judgeCall("call-1", "git push origin main"),
			fakeContext(() => void opened++),
		);

		expect(opened).toBe(0);
		expect(asked[0]?.questions[0]?.question).toContain("git push origin main");
	});

	test("the answer comes back to the gate: no blocks the call", async () => {
		const { bus } = questionsProvider([answerTo("no")]);
		const { toolCall } = harness("judge", "ask", bus);
		const result = await toolCall(judgeCall("call-1", "git push origin main"), fakeContext());
		expect(result).toEqual({ block: true, reason: expect.stringContaining("denied by the user") });
	});

	test("always yes remembers at the level and the scope that were picked", async () => {
		const { bus, asked } = questionsProvider([
			answerTo("always yes"),
			answerTo("git push"),
			answerTo("this project"),
		]);
		const { toolCall, state } = harness("judge", "ask", bus);

		await toolCall(judgeCall("call-1", "git push origin main"), fakeContext());

		expect(state.alwaysYes.has("bash", ["git push"])).toBe(true);
		expect(asked).toHaveLength(3);
	});

	test("with no questions feature the host's selector asks", async () => {
		const { toolCall } = harness("judge", "ask");
		let opened = 0;
		await toolCall(
			judgeCall("call-1", "git push origin main"),
			fakeContext(() => void opened++),
		);
		expect(opened).toBe(1);
	});
});

describe("session modes", () => {
	test("manual never asks the judge", async () => {
		const { state, toolCall } = harness("manual");
		await toolCall(judgeCall("call-1", "git push origin main"), fakeContext());
		expect(state.judgeLog).toHaveLength(0);
	});

	test("full runs a command whose paths it cannot read", async () => {
		const { toolCall } = harness("full");
		let opened = false;

		const result = await toolCall(
			judgeCall("call-1", `cat "$SECRET"`),
			fakeContext(() => {
				opened = true;
			}),
		);

		expect(result).toBeUndefined();
		expect(opened).toBe(false);
	});

	test("full runs a bash call without opening the dialog", async () => {
		const { toolCall } = harness("full");
		let opened = false;

		const result = await toolCall(
			judgeCall("call-1", "rm -rf build"),
			fakeContext(() => {
				opened = true;
			}),
		);

		expect(result).toBeUndefined();
		expect(opened).toBe(false);
	});

	test("edits still asks before powershell, whose paths it cannot read", async () => {
		const { toolCall } = harness("edits");
		let opened = false;

		await toolCall(
			{ toolName: "powershell", toolCallId: "call-1", input: { command: "Remove-Item C:\\x" } },
			fakeContext(() => {
				opened = true;
			}),
		);

		expect(opened).toBe(true);
	});

	test("edits runs a write without opening the dialog", async () => {
		const { toolCall } = harness("edits");
		let opened = false;

		const result = await toolCall(
			writeCall("call-1"),
			fakeContext(() => {
				opened = true;
			}),
		);

		expect(result).toBeUndefined();
		expect(opened).toBe(false);
	});

	test("edits still gates bash", async () => {
		const { toolCall } = harness("edits");
		let opened = false;

		await toolCall(
			judgeCall("call-1", "git push origin main"),
			fakeContext(() => {
				opened = true;
			}),
		);

		expect(opened).toBe(true);
	});

	test("manual gates a write", async () => {
		const { toolCall } = harness("manual");
		let opened = false;

		await toolCall(
			writeCall("call-1"),
			fakeContext(() => {
				opened = true;
			}),
		);

		expect(opened).toBe(true);
	});
});

describe("workspace scope", () => {
	test("full does not approve a call outside the workspace", async () => {
		const { state, toolCall } = harness("full");
		let opened = false;

		await toolCall(
			judgeCall("call-1", "cat /etc/passwd"),
			fakeContext(() => {
				opened = true;
			}),
		);

		expect(opened).toBe(true);
		expect(state.judgeLog).toHaveLength(0);
	});

	test("edits does not approve a write outside the workspace", async () => {
		const { toolCall } = harness("edits");
		let opened = false;

		await toolCall(
			writeCall("call-1", "/etc/hosts"),
			fakeContext(() => {
				opened = true;
			}),
		);

		expect(opened).toBe(true);
	});

	test("a reference resolves through the loop that owns it", async () => {
		const { toolCall } = harness("full");
		let opened = false;

		const result = await toolCall(
			judgeCall("call-1", `for f in src/a.ts src/b.ts; do cat "$f"; done`),
			fakeContext(() => {
				opened = true;
			}),
		);

		expect(result).toBeUndefined();
		expect(opened).toBe(false);
	});

	test("a reference the loop cannot resolve still asks in edits", async () => {
		const { toolCall } = harness("edits");
		let opened = false;

		await toolCall(
			judgeCall("call-1", `cat "$SECRET"`),
			fakeContext(() => {
				opened = true;
			}),
		);

		expect(opened).toBe(true);
	});

	test("always yes for this session is written to the session", async () => {
		const { entries, state, toolCall } = harness("manual");
		const answer: DialogAnswer = { decision: "allow", remember: "rm -rf build", scope: "session" };

		await toolCall(
			judgeCall("call-1", "rm -rf build"),
			fakeContext(() => {}, answer),
		);

		expect(state.alwaysYes.has("bash", ["rm -rf build"])).toBe(true);
		expect(entries).toContainEqual({
			customType: "pi-ask-permission:session",
			data: { kind: "always-yes", toolName: "bash", level: "rm -rf build" },
		});
	});

	test("every decision is announced, and the dialog's answer is kept in the session", async () => {
		const { entries, decided, toolCall } = harness("manual");

		await toolCall(judgeCall("call-1", "git status"), fakeContext());
		await toolCall(judgeCall("call-2", "rm -rf build"), fakeContext());

		expect(decided).toEqual([
			expect.objectContaining({ toolCallId: "call-1", action: "allow", by: "read-only bash" }),
			expect.objectContaining({ toolCallId: "call-2", action: "allow", by: "you" }),
		]);
		expect(entries.filter((entry) => entry.customType === "pi-ask-permission:answer")).toEqual([
			{
				customType: "pi-ask-permission:answer",
				data: expect.objectContaining({ toolCallId: "call-2" }),
			},
		]);
	});

	test("always yes still wins over the boundary", async () => {
		const { state, toolCall } = harness("manual");
		let opened = false;
		state.alwaysYes.add("session", "bash", "cat /etc/passwd");

		const result = await toolCall(
			judgeCall("call-1", "cat /etc/passwd"),
			fakeContext(() => {
				opened = true;
			}),
		);

		expect(result).toBeUndefined();
		expect(opened).toBe(false);
	});

	test("a folder opened from the dialog lets the next reads there run", async () => {
		const { entries, state, toolCall } = harness("manual");
		const answer: DialogAnswer = {
			decision: "allow",
			open: { path: "/etc", access: "read", scope: "session" },
		};
		await toolCall(
			judgeCall("call-1", "cat /etc/hostname"),
			fakeContext(() => {}, answer),
		);

		expect(state.folders.covers("/etc/passwd", "read")).toBe(true);
		expect(entries).toContainEqual({
			customType: "pi-ask-permission:session",
			data: { kind: "folder", path: "/etc", access: "read" },
		});

		let opened = false;
		const result = await toolCall(
			judgeCall("call-2", "cat /etc/passwd"),
			fakeContext(() => {
				opened = true;
			}),
		);
		expect(result).toBeUndefined();
		expect(opened).toBe(false);
	});

	test("the folder is offered only when the workspace is what asks", async () => {
		const shown: string[] = [];
		const ctx = (): ExtensionContext => fakeContext((labels) => shown.push(labels.join("\n")));

		await harness("manual").toolCall(judgeCall("call-1", "cat /etc/hostname"), ctx());
		await harness("manual", "allow").toolCall(judgeCall("call-2", "touch /etc/x.conf"), ctx());

		expect(shown[0]).toContain("yes, and allow reads in /etc");
		expect(shown[1]).not.toContain("/etc to the workspace");
	});

	test("outside deny blocks before the dialog", async () => {
		const { entries, toolCall } = harness("full", "deny");

		const result = await toolCall(judgeCall("call-1", "cat /etc/passwd"), fakeContext());

		expect(result).toEqual({ block: true, reason: expect.stringContaining("/etc/passwd") });
		expect(entries.map((entry) => entry.customType)).toEqual(["pi-ask-permission:ruling"]);
	});

	test("outside allow lets full run anywhere", async () => {
		const { toolCall } = harness("full", "allow");
		let opened = false;

		const result = await toolCall(
			judgeCall("call-1", "cat /etc/passwd"),
			fakeContext(() => {
				opened = true;
			}),
		);

		expect(result).toBeUndefined();
		expect(opened).toBe(false);
	});
});

describe("an MCP call in the dialog", () => {
	test("the hint the server declares reaches the question", async () => {
		const { bus, asked } = questionsProvider([answerTo("yes")]);
		const { fake, toolCall } = harness("manual", "ask", bus);
		fake.allTools.push(
			toolInfo("mcp__sauron__delete_dashboard", {
				namespace: { name: "mcp__sauron" },
				annotations: { destructiveHint: true },
			}),
		);

		await toolCall(
			{ toolName: "mcp__sauron__delete_dashboard", toolCallId: "call-1", input: { id: 12 } },
			fakeContext(),
		);

		expect(asked[0]?.questions[0]?.question).toContain("sauron:delete_dashboard (destructive");
	});
});
