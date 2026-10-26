// One sequence of logged events through the three holders of the state: bridge, daemon and client.
// A holder that stops calling `applyChange` keeps every reducer test green, so each is checked here.
import { describe, expect, test } from "bun:test";

import {
	applyChange,
	emptySessionState,
	isStateChangeType,
	type SessionState,
} from "@adeildo/pi-remote-protocol";
import { type ClientSession, readEnvelope, sessionOf } from "@adeildo/pi-remote-protocol/client";

import { Harness } from "../src/bridge/logged.ts";
import { Sessions } from "../src/daemon/sessions.ts";

const key = { machine: "m", session: "s" };
/** A line the tasks wrote before they were removed, which an older log still carries. */
const tasks = { version: 1, tasks: [], decisions: [], nextTask: 1, nextDecision: 1, updatedAt: 1 };
const queued = (id: string) => ({
	id,
	by: { kind: "client", name: "phone", machine: "laptop" },
	text: `message ${id}`,
	want: "followUp",
	when: 1,
});

type Logged = { type: string; data: unknown };

/** A sequence of logged events, and the state every holder of the state must end up with. */
interface Row {
	name: string;
	events: Logged[];
	/** What the state holds, written out: the reducer is compared against this, not against itself. */
	expects: unknown;
	leaves: (state: SessionState) => unknown;
}

function folded(events: Logged[]): SessionState {
	return events.reduce(
		(state, one) => (isStateChangeType(one.type) ? applyChange(state, one.type, one.data) : state),
		emptySessionState(),
	);
}

const ROWS: Row[] = [
	{
		name: "nothing at all is an empty state, not a missing one",
		events: [],
		expects: { questions: {}, permissions: { rulings: {} }, queue: [] },
		leaves: (state) => state,
	},
	{
		name: "a tasks line from an older log changes nothing",
		events: [{ type: "tasks.changed", data: { state: tasks } }],
		expects: { questions: {}, permissions: { rulings: {} }, queue: [] },
		leaves: (state) => ({ ...state }),
	},
	{
		name: "mode, a question and its answer",
		events: [
			{ type: "mode.changed", data: { mode: "edits" } },
			{ type: "ask.opened", data: { id: "q1", source: "agent", questions: [] } },
			{
				type: "ask.closed",
				data: { id: "q1", by: { kind: "client", name: "phone" }, result: {} },
			},
		],
		expects: {
			mode: "edits",
			// `ask.closed` keeps what the answer needs: the id, the result, who answered. The question
			// text belongs to the opening, and the closed entry does not repeat it.
			ask: {
				id: "q1",
				result: {},
				closed: true,
				by: { kind: "client", name: "phone" },
			},
		},
		leaves: (state) => ({
			mode: state.permissions.mode,
			ask: state.questions.q1,
		}),
	},
	{
		name: "a second answer that names nobody keeps who gave the first, and a named one replaces it",
		events: [
			{ type: "ask.opened", data: { id: "q1", source: "agent", questions: [] } },
			{ type: "ask.closed", data: { id: "q1", by: { kind: "client", name: "phone" }, result: {} } },
			{ type: "ask.closed", data: { id: "q1", result: {} } },
			{ type: "ask.opened", data: { id: "q2", source: "agent", questions: [] } },
			{ type: "ask.closed", data: { id: "q2", by: { kind: "client", name: "phone" }, result: {} } },
			{
				type: "ask.closed",
				data: { id: "q2", by: { kind: "client", name: "tablet" }, result: {} },
			},
		],
		expects: { first: "phone", replaced: "tablet" },
		leaves: (state) => ({
			first: (state.questions.q1 as { by?: { name: string } }).by?.name,
			replaced: (state.questions.q2 as { by?: { name: string } }).by?.name,
		}),
	},
	{
		name: "the queue is the last list written, and clearing it leaves an empty one",
		events: [
			{ type: "queue.changed", data: { queue: [queued("a")] } },
			{ type: "queue.changed", data: { queue: [queued("a"), queued("b")] } },
			{ type: "queue.changed", data: { queue: [] } },
		],
		expects: [],
		leaves: (state) => state.queue,
	},
	{
		name: "the cost of the session is the last sum the bridge sent, and a bad one is ignored",
		events: [
			{
				type: "cost.changed",
				data: { cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 0.05 } },
			},
			{
				type: "cost.changed",
				data: { cost: { input: 2, output: 3, cacheRead: 4, cacheWrite: 5, total: 0.08 } },
			},
		],
		expects: 0.08,
		leaves: (state) => state.cost?.total,
	},
	{
		name: "the terminal waits on a dialog from when it opens until it closes",
		events: [
			{ type: "terminal.prompted", data: { open: true, kind: "custom", title: "Theme" } },
			{ type: "terminal.prompted", data: { open: false, kind: "custom" } },
			{ type: "terminal.prompted", data: { open: true, kind: "editor" } },
		],
		expects: { kind: "editor", title: undefined },
		leaves: (state) => state.prompt,
	},
	{
		name: "closing the dialog ends the wait",
		events: [
			{ type: "terminal.prompted", data: { open: true, kind: "custom", title: "Theme" } },
			{ type: "terminal.prompted", data: { open: false, kind: "custom" } },
		],
		expects: undefined,
		leaves: (state) => state.prompt,
	},
	{
		name: "a prompt marked with the client that sent it is remembered by its entry",
		events: [
			{
				type: "prompt.from",
				data: { entry: "e1", by: { kind: "client", name: "phone", machine: "box" } },
			},
		],
		expects: { e1: { kind: "client", name: "phone", machine: "box" } },
		leaves: (state) => state.promptFrom,
	},
	{
		name: "a mark with no entry, or with no sender, changes nothing",
		events: [
			{ type: "prompt.from", data: { by: { kind: "client", name: "phone", machine: "box" } } },
			{ type: "prompt.from", data: { entry: "e1" } },
		],
		expects: undefined,
		leaves: (state) => state.promptFrom,
	},
	{
		name: "the state keeps the senders of the last hundred prompts and lets the older ones go",
		events: Array.from({ length: 101 }, (_, at) => ({
			type: "prompt.from" as const,
			data: { entry: `e${at}`, by: { kind: "client", name: "phone", machine: "box" } },
		})),
		expects: { first: "e1", count: 100 },
		leaves: (state) => ({
			first: Object.keys(state.promptFrom ?? {})[0],
			count: Object.keys(state.promptFrom ?? {}).length,
		}),
	},
	{
		name: "the models a bridge listed are kept, each with its provider, id and name",
		events: [
			{
				type: "models.listed",
				data: { models: [{ provider: "anthropic", id: "opus", name: "Opus" }] },
			},
		],
		expects: [{ provider: "anthropic", id: "opus", name: "Opus" }],
		leaves: (state) => state.models,
	},
	{
		name: "a list with one model that has no name is not read, so a model that cannot be read is never offered",
		events: [
			{
				type: "models.listed",
				data: {
					models: [
						{ provider: "anthropic", id: "opus", name: "Opus" },
						{ provider: "anthropic", id: "haiku" },
					],
				},
			},
		],
		expects: undefined,
		leaves: (state) => state.models,
	},
	{
		name: "an empty list is a list: the bridge said there is no model, and that is not silence",
		events: [{ type: "models.listed", data: { models: [] } }],
		expects: [],
		leaves: (state) => state.models,
	},
	{
		name: "the state keeps the first three hundred models of a registry and lets the rest go",
		events: [
			{
				type: "models.listed",
				data: {
					models: Array.from({ length: 301 }, (_, at) => ({
						provider: "p",
						id: `m${at}`,
						name: `M${at}`,
					})),
				},
			},
		],
		expects: { count: 300, last: "m299", total: 301 },
		leaves: (state) => ({
			count: state.models?.length,
			last: state.models?.at(-1)?.id,
			total: state.modelsTotal,
		}),
	},
	{
		name: "a dialog a client can answer is not a wait on the terminal",
		events: [{ type: "terminal.prompted", data: { open: true, kind: "select", title: "Pick" } }],
		expects: undefined,
		leaves: (state) => state.prompt,
	},
	{
		name: "a cost that is not five numbers never becomes the state",
		events: [{ type: "cost.changed", data: { cost: { input: "1", total: Number.NaN } } }],
		expects: undefined,
		leaves: (state) => state.cost,
	},
	{
		name: "an event this version cannot read leaves the state as it was",
		events: [{ type: "mode.changed", data: { mode: "not a mode" } }],
		expects: undefined,
		leaves: (state) => state.permissions.mode,
	},
	{
		name: "the door and the epoch are the stream's, not the state's",
		events: [
			{ type: "leaf.changed", data: { leaf: null } },
			{ type: "stream.bound", data: { messages: [] } },
		],
		expects: { questions: {}, permissions: { rulings: {} }, queue: [] },
		leaves: (state) => ({ ...state }),
	},
];

/** The bridge holds the state it sends: it folds what the log wrote and hands the opening the result. */
function heldByBridge(events: Logged[]): SessionState {
	const harness = new Harness();
	for (const one of events) harness.saw(one.type, one.data);
	return harness.state(undefined);
}

/** The daemon keeps its own copy, seeded by the opening and folded on every event it forwards. */
function heldByDaemon(events: Logged[]): SessionState | undefined {
	const sessions = new Sessions();
	sessions.live(
		{
			v: 1,
			kind: "event",
			machine: "m",
			session: "s",
			epoch: "e",
			type: "session.live",
			seq: 0,
			at: 0,
			data: {
				pid: 1,
				startedAt: 1,
				cwd: "/x",
				kind: "terminal",
			},
		} as never,
		{ pid: 1, startedAt: 1, cwd: "/x", kind: "terminal" },
	);
	events.forEach((one, at) => {
		sessions.event({
			v: 1,
			kind: "event",
			machine: "m",
			session: "s",
			epoch: "e",
			type: one.type,
			seq: at + 1,
			at: 0,
			data: one.data,
		} as never);
	});
	return sessions.get("s")?.state;
}

/** The client is a replica: it reads each envelope and folds it into the state it draws. */
function heldByClient(events: Logged[]): SessionState {
	let session = sessionOf(key);
	// A client that is already following this epoch: the events below are the ones it reads live, and
	// a client that has just opened would ask for the state and get it whole instead.
	session.cursor = { epoch: "e", seq: 0 };
	events.forEach((one, at) => {
		session = read(session, {
			v: 1,
			kind: "event",
			machine: "m",
			session: "s",
			epoch: "e",
			type: one.type,
			seq: at + 1,
			at: 0,
			data: one.data,
		});
	});
	return session.state;
}

/** Reads an envelope and keeps the session it returned: reading never mutates the one it was given. */
function read(session: ClientSession, value: unknown): ClientSession {
	const answer = readEnvelope(session, value);
	return answer.read === "now" ? answer.session : session;
}

describe("the state a sequence of events leaves, in each holder of it", () => {
	for (const row of ROWS) {
		test(`the reducer: ${row.name}`, () => {
			expect(row.leaves(folded(row.events))).toEqual(row.expects);
		});

		test(`the bridge: ${row.name}`, () => {
			expect(row.leaves(heldByBridge(row.events))).toEqual(row.expects);
		});

		test(`the daemon: ${row.name}`, () => {
			expect(row.leaves(heldByDaemon(row.events) ?? emptySessionState())).toEqual(row.expects);
		});

		test(`the client: ${row.name}`, () => {
			expect(row.leaves(heldByClient(row.events))).toEqual(row.expects);
		});
	}
});
