// A real pi session inside a test, with a scripted model: real events, session file and log, no network.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	type FauxProviderHandle,
	type FauxResponseFactory,
	type FauxResponseStep,
	fauxProvider,
} from "@earendil-works/pi-ai";
import {
	type AgentSession,
	createAgentSession,
	DefaultResourceLoader,
	type ExtensionFactory,
	type ExtensionUIContext,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";

import { darkTheme } from "./dark-theme.ts";
import { eventsDir, logPath } from "./events/log.ts";

export interface RigOptions {
	/** The extensions the run loads, the way the harness loads its own. */
	extensions?: readonly ExtensionFactory[];
	/** What the model answers, in order. */
	replies?: readonly FauxResponseStep[];
	/** A run asks more than once (tool results, compaction), so answer from the request. */
	answer?: FauxResponseFactory;
	/** Without it the answer arrives in one microtask. */
	tokensPerSecond?: number;
	/** Where the session file, the log and the working folder go. A temporary folder otherwise. */
	root?: string;
	/** Where the session works. A folder under the root otherwise. */
	cwd?: string;
	/** Never the settings of the machine running the test. */
	settings?: Record<string, unknown>;
	/** Dialogs the script does not answer come back cancelled, as Esc leaves them. */
	says?: RigSays;
}

/** What the terminal answers, one queue per kind of dialog. */
export interface RigSays {
	select?: (string | undefined)[];
	confirm?: boolean[];
	input?: (string | undefined)[];
	editor?: (string | undefined)[];
}

/** The model a rig answers as, so a feature's setting can name it. */
export const SCRIPTED = "rig/scripted";

/** The root of the rig in use, since the environment it sets is shared by the process. */
let open: string | undefined;

/** Puts an environment variable back the way the test found it. */
function restore(name: string, before: string | undefined): void {
	if (before === undefined) delete process.env[name];
	else process.env[name] = before;
}

/** The harness's lines for a session, in the order it wrote them. */
function loggedIn(
	events: string,
	cwd: string,
	session: string,
): { type: string; data: Record<string, unknown> }[] {
	const file = logPath({ dir: eventsDir(cwd, events), session });
	let text: string;
	try {
		text = readFileSync(file, "utf8");
	} catch {
		// No feature has written yet. That is a run with nothing to say, not a broken log.
		return [];
	}
	return text
		.trim()
		.split("\n")
		.filter((line) => line.length > 0)
		.map((line, at) => {
			try {
				return JSON.parse(line) as { type: string; data: Record<string, unknown> };
			} catch (error) {
				throw new Error(`${file}:${at + 1} is not a log line: ${String(error)}`, { cause: error });
			}
		});
}

export interface Rig {
	session: AgentSession;
	faux: FauxProviderHandle;
	/** The folder holding everything this run wrote. */
	root: string;
	/** Where the session works. */
	cwd: string;
	/** The harness log's folder, which `PI_HARNESS_EVENTS` points at while the rig is open. */
	events: string;
	/** The folder pi's session files go in. */
	sessions: string;
	/** What the features told the terminal, in the order they said it: `ctx.ui.notify`, as it reads. */
	notified: { message: string; level: string }[];
	/** What extensions threw where pi could not show it, as pi formatted it. */
	errors: { event: string; error: string; stack?: string }[];
	/** Sends a prompt and waits for the run it starts to settle. */
	prompt(text: string): Promise<void>;
	/** A feature that calls its own model writes after the run settles. */
	until(
		match: (line: { type: string; data: Record<string, unknown> }) => boolean,
		ms?: number,
	): Promise<{ type: string; data: Record<string, unknown> }[]>;
	/** Ends the rig and puts the environment back. */
	dispose(): void;
}

function scriptedUI(
	says: RigSays,
	notified: { message: string; level: string }[],
): ExtensionUIContext {
	const select = [...(says.select ?? [])];
	const confirm = [...(says.confirm ?? [])];
	const input = [...(says.input ?? [])];
	const editor = [...(says.editor ?? [])];
	return {
		select: async () => select.shift(),
		confirm: async () => confirm.shift() ?? false,
		input: async () => input.shift(),
		notify: (message: string, level?: string) => {
			notified.push({ message, level: level ?? "info" });
		},
		onTerminalInput: () => () => {},
		setStatus: () => {},
		setWorkingMessage: () => {},
		setWorkingVisible: () => {},
		setWorkingIndicator: () => {},
		setHiddenThinkingLabel: () => {},
		setWidget: () => {},
		setFooter: () => {},
		setHeader: () => {},
		setTitle: () => {},
		custom: async () => {
			throw new Error("the rig has no screen to draw a dialog on; answer through select or input");
		},
		pasteToEditor: () => {},
		setEditorText: () => {},
		getEditorText: () => "",
		editor: async () => editor.shift(),
		addAutocompleteProvider: () => {},
		setEditorComponent: () => {},
		getEditorComponent: () => undefined,
		theme: darkTheme(),
		getAllThemes: () => [],
		getTheme: () => undefined,
		setTheme: () => ({ success: false, error: "the rig has one theme" }),
		getToolsExpanded: () => false,
		setToolsExpanded: () => {},
	};
}

/** One at a time: the log folder and settings come from process-wide variables. */
export async function createRig(options: RigOptions = {}): Promise<Rig> {
	if (open !== undefined) {
		throw new Error(`a rig is already open on ${open}; dispose it before opening another`);
	}
	const root = options.root ?? mkdtempSync(join(tmpdir(), "pi-rig-"));
	open = root;
	const cwd = options.cwd ?? join(root, "work");
	const sessions = join(root, "sessions");
	const events = join(root, "events");
	const agentDir = join(root, "agent");
	for (const folder of [cwd, sessions, events, agentDir]) mkdirSync(folder, { recursive: true });

	// The features read the log's folder and their settings from here, so both have to be in place
	// before any of them runs.
	const beforeEvents = process.env.PI_HARNESS_EVENTS;
	const beforeAgent = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_HARNESS_EVENTS = events;
	process.env.PI_CODING_AGENT_DIR = agentDir;
	if (options.settings !== undefined) {
		const settingsDir = join(agentDir, "extensions", "pi-harness");
		mkdirSync(settingsDir, { recursive: true });
		writeFileSync(
			join(settingsDir, "settings.json"),
			`${JSON.stringify(options.settings, null, "\t")}\n`,
		);
	}

	const faux = fauxProvider({
		provider: "rig",
		models: [{ id: "scripted", name: "Scripted" }],
		...(options.tokensPerSecond === undefined ? {} : { tokensPerSecond: options.tokensPerSecond }),
	});
	const answer = options.answer;
	if (answer === undefined) {
		faux.setResponses([...(options.replies ?? [])]);
	} else {
		// The provider takes its replies off a list, so the script puts itself back before answering.
		const step: FauxResponseFactory = (context, settings, state, model) => {
			faux.appendResponses([step]);
			return answer(context, settings, state, model);
		};
		faux.setResponses([step]);
	}

	// No models.json and no network: the only provider is the scripted one.
	const modelRuntime = await ModelRuntime.create({ modelsPath: null, allowModelNetwork: false });
	modelRuntime.registerNativeProvider(faux.provider);

	const settingsManager = SettingsManager.inMemory({
		// Auto-compaction stays off: a scripted run compacts when the script asks. The window kept is
		// one token, so a run of a few messages still has something to compact.
		compaction: { enabled: false, keepRecentTokens: 1 },
		retry: { enabled: false },
	});

	const resourceLoader = new DefaultResourceLoader({
		cwd,
		agentDir,
		settingsManager,
		extensionFactories: [...(options.extensions ?? [])],
		// The run holds only what the test gave it: no packages, skills, prompts, themes or context
		// files from the machine it happens to run on.
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
	});
	await resourceLoader.reload();

	// What the features said to the terminal, kept for a test that reads it instead of the screen.
	const notified: { message: string; level: string }[] = [];
	// What an extension threw where pi swallows it, kept for the same reason: an error a test cannot
	// see is an error that looks like nothing happening.
	const errors: { event: string; error: string; stack?: string }[] = [];
	let session: AgentSession;
	try {
		({ session } = await createAgentSession({
			cwd,
			agentDir,
			model: faux.getModel(),
			thinkingLevel: "off",
			modelRuntime,
			settingsManager,
			resourceLoader,
			sessionManager: SessionManager.create(cwd, sessions),
		}));

		// `session_start` reaches the extensions through the bindings, not through creation, so a rig
		// that skips this one runs with every feature asleep. No terminal: this is a run, not a screen.
		await session.bindExtensions({
			mode: "rpc",
			uiContext: scriptedUI(options.says ?? {}, notified),
			onError: (error) =>
				errors.push({
					event: error.event,
					error: String(error.error),
					// The line, not just the message: an error a test reads is worth more with where.
					...(error.stack === undefined ? {} : { stack: error.stack }),
				}),
		});
	} catch (error) {
		// A session that never opened leaves nothing behind for the next rig in this file to trip on.
		open = undefined;
		restore("PI_HARNESS_EVENTS", beforeEvents);
		restore("PI_CODING_AGENT_DIR", beforeAgent);
		throw error;
	}

	const rig: Rig = {
		session,
		faux,
		root,
		cwd,
		events,
		sessions,
		notified,
		errors,
		prompt: async (text) => {
			await session.prompt(text);
			await session.waitForIdle();
		},
		until: async (match, ms = 2_000) => {
			const deadline = Date.now() + ms;
			for (;;) {
				const lines = loggedIn(events, cwd, session.sessionId);
				if (lines.some(match)) return lines;
				if (Date.now() > deadline) {
					const seen = [...new Set(lines.map((line) => line.type))].join(", ") || "nothing";
					throw new Error(`the log never held it in ${ms} ms; it held ${seen}`);
				}
				await new Promise((resolve) => setTimeout(resolve, 10));
			}
		},
		dispose: () => {
			session.dispose();
			restore("PI_HARNESS_EVENTS", beforeEvents);
			restore("PI_CODING_AGENT_DIR", beforeAgent);
			open = undefined;
			if (options.root === undefined) rmSync(root, { recursive: true, force: true });
		},
	};
	return rig;
}
