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
	extensions?: readonly ExtensionFactory[];
	replies?: readonly FauxResponseStep[];
	/** A run asks more than once (tool results, compaction), so answer from the request. */
	answer?: FauxResponseFactory;
	/** Without it the answer arrives in one microtask. */
	tokensPerSecond?: number;
	/** A temporary folder otherwise. */
	root?: string;
	cwd?: string;
	/** Never the settings of the machine running the test. */
	settings?: Record<string, unknown>;
	/** Dialogs the script does not answer come back cancelled, as Esc leaves them. */
	says?: RigSays;
	/** The model the session shows; `scripted` otherwise. A picture wants a real-looking one. */
	model?: { id: string; name: string };
}

export interface RigSays {
	select?: (string | undefined)[];
	confirm?: boolean[];
	input?: (string | undefined)[];
	editor?: (string | undefined)[];
}

/** So a feature's setting can name it. */
export const SCRIPTED = "rig/scripted";

let open: string | undefined;

function restore(name: string, before: string | undefined): void {
	if (before === undefined) delete process.env[name];
	else process.env[name] = before;
}

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
		// No feature has written yet: nothing to say, not a broken log.
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
	root: string;
	cwd: string;
	/** `PI_HARNESS_EVENTS` points here while the rig is open. */
	events: string;
	sessions: string;
	/** `ctx.ui.notify`, in order. */
	notified: { message: string; level: string }[];
	/** What extensions threw where pi could not show it, as pi formatted it. */
	errors: { event: string; error: string; stack?: string }[];
	prompt(text: string): Promise<void>;
	/** A feature that calls its own model writes after the run settles. */
	until(
		match: (line: { type: string; data: Record<string, unknown> }) => boolean,
		ms?: number,
	): Promise<{ type: string; data: Record<string, unknown> }[]>;
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

	// Features read the log folder and settings from here, so both must be set before any runs.
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
		models: [options.model ?? { id: "scripted", name: "Scripted" }],
		...(options.tokensPerSecond === undefined ? {} : { tokensPerSecond: options.tokensPerSecond }),
	});
	const answer = options.answer;
	if (answer === undefined) {
		faux.setResponses([...(options.replies ?? [])]);
	} else {
		// The provider takes replies off a list, so the script puts itself back before answering.
		const step: FauxResponseFactory = (context, settings, state, model) => {
			faux.appendResponses([step]);
			return answer(context, settings, state, model);
		};
		faux.setResponses([step]);
	}

	// No models.json and no network: the scripted provider is the only one.
	const modelRuntime = await ModelRuntime.create({ modelsPath: null, allowModelNetwork: false });
	modelRuntime.registerNativeProvider(faux.provider);

	const settingsManager = SettingsManager.inMemory({
		// Off: a scripted run compacts when the script asks. Keeping one token lets a short run compact.
		compaction: { enabled: false, keepRecentTokens: 1 },
		retry: { enabled: false },
	});

	const resourceLoader = new DefaultResourceLoader({
		cwd,
		agentDir,
		settingsManager,
		extensionFactories: [...(options.extensions ?? [])],
		// Nothing from the machine: no packages, skills, prompts, themes or context files.
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
	});
	await resourceLoader.reload();

	const notified: { message: string; level: string }[] = [];
	// What pi swallows: an error a test cannot see looks like nothing happening.
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

		// `session_start` reaches the extensions through the bindings; skipping this leaves every feature asleep.
		await session.bindExtensions({
			mode: "rpc",
			uiContext: scriptedUI(options.says ?? {}, notified),
			onError: (error) =>
				errors.push({
					event: error.event,
					error: String(error.error),
					...(error.stack === undefined ? {} : { stack: error.stack }),
				}),
		});
	} catch (error) {
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
