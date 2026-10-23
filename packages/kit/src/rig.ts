// A real pi session inside a test, with a scripted model. What a slice of the remote work needs to
// prove: pi's real events, the real session file and the real harness log, with no network, no
// tokens spent and nothing from anyone's history in the repository.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
	Theme,
} from "@earendil-works/pi-coding-agent";

import { eventsDir, logPath } from "./events/log.ts";

export interface RigOptions {
	/** The extensions the run loads, the way the harness loads its own. */
	extensions?: readonly ExtensionFactory[];
	/** What the model answers, in order. */
	replies?: readonly FauxResponseStep[];
	/**
	 * What the model answers to every request, read from the request itself. A run asks more than
	 * once: the tasks feature asks the same model with a prompt of its own, and a compaction asks for
	 * a summary. A script that only lists replies runs out in the middle of one.
	 */
	answer?: FauxResponseFactory;
	/** Where the session file, the log and the working folder go. A temporary folder otherwise. */
	root?: string;
	/** Where the session works. A folder under the root otherwise. */
	cwd?: string;
	/**
	 * The harness's settings for this run, written where the features read them. A run without them
	 * gets the harness defaults, never the settings of the machine it happens to run on.
	 */
	settings?: Record<string, unknown>;
	/**
	 * What the terminal answers when a feature asks, in order. The dialogs a run cannot answer come
	 * back as cancelled, the way Esc leaves them, so a feature never hangs a test.
	 */
	says?: RigSays;
}

/** What the terminal answers, one queue per kind of dialog. */
export interface RigSays {
	select?: (string | undefined)[];
	confirm?: boolean[];
	input?: (string | undefined)[];
	editor?: (string | undefined)[];
}

/** The provider the scripted model answers as, so a setting can name `rig/scripted`. */
export const SCRIPTED = "rig";

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
	try {
		return readFileSync(file, "utf8")
			.trim()
			.split("\n")
			.filter((line) => line.length > 0)
			.map((line) => JSON.parse(line) as { type: string; data: Record<string, unknown> });
	} catch {
		return [];
	}
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
	/** Sends a prompt and waits for the run it starts to settle. */
	prompt(text: string): Promise<void>;
	/**
	 * Waits until the log holds a line the predicate accepts, and answers every line written so far.
	 * A feature that asks a model of its own writes after the run settles, so a test that reads the
	 * log as the run ends races it.
	 */
	until(
		match: (line: { type: string; data: Record<string, unknown> }) => boolean,
		ms?: number,
	): Promise<{ type: string; data: Record<string, unknown> }[]>;
	/** Ends the rig and puts the environment back. */
	dispose(): void;
}

/** The tokens a theme paints as a background rather than as a foreground. */
const BACKGROUND_TOKENS = new Set([
	"selectedBg",
	"searchMatchBg",
	"userMessageBg",
	"customMessageBg",
	"toolPendingBg",
	"toolSuccessBg",
	"toolErrorBg",
]);

/**
 * The theme pi ships as `dark`, built from the file pi reads. A scripted run has no terminal to
 * report one, and a feature that paints a status line still gets the colors it expects.
 */
function darkTheme(): Theme {
	const root = dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")));
	const file = JSON.parse(
		readFileSync(join(root, "modes/interactive/theme/dark.json"), "utf8"),
	) as { vars: Record<string, string | number>; colors: Record<string, string | number> };
	const resolve = (value: string | number, seen: Set<string>): string | number => {
		if (typeof value !== "string") return value;
		const target = file.vars[value];
		if (target === undefined || seen.has(value)) return value;
		return resolve(target, seen.add(value));
	};
	const foreground: Record<string, string | number> = {};
	const background: Record<string, string | number> = {};
	for (const [token, value] of Object.entries(file.colors)) {
		const target = BACKGROUND_TOKENS.has(token) ? background : foreground;
		target[token] = resolve(value, new Set());
	}
	return new Theme(
		foreground as ConstructorParameters<typeof Theme>[0],
		background as ConstructorParameters<typeof Theme>[1],
		"truecolor",
		{ name: "dark" },
	);
}

/**
 * The screen a scripted run answers through. It holds only what a feature asks: the dialogs, which
 * come from the script, and no drawing at all.
 */
function scriptedUI(says: RigSays): ExtensionUIContext {
	const select = [...(says.select ?? [])];
	const confirm = [...(says.confirm ?? [])];
	const input = [...(says.input ?? [])];
	const editor = [...(says.editor ?? [])];
	return {
		select: async () => select.shift(),
		confirm: async () => confirm.shift() ?? false,
		input: async () => input.shift(),
		notify: () => {},
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

/**
 * A pi session with the harness's extensions and a model that answers from a script. Two rigs in one
 * test are two sessions in two folders, which is what the phases check with a real pi.
 */
export async function createRig(options: RigOptions = {}): Promise<Rig> {
	const root = options.root ?? mkdtempSync(join(tmpdir(), "pi-rig-"));
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

	const faux = fauxProvider({ provider: SCRIPTED, models: [{ id: "scripted", name: "Scripted" }] });
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

	const { session } = await createAgentSession({
		cwd,
		agentDir,
		model: faux.getModel(),
		thinkingLevel: "off",
		modelRuntime,
		settingsManager,
		resourceLoader,
		sessionManager: SessionManager.create(cwd, sessions),
	});

	// `session_start` reaches the extensions through the bindings, not through creation, so a rig
	// that skips this one runs with every feature asleep. No terminal: this is a run, not a screen.
	await session.bindExtensions({ mode: "rpc", uiContext: scriptedUI(options.says ?? {}) });

	const rig: Rig = {
		session,
		faux,
		root,
		cwd,
		events,
		sessions,
		prompt: async (text) => {
			await session.prompt(text);
			await session.waitForIdle();
		},
		until: async (match, ms = 2_000) => {
			const deadline = Date.now() + ms;
			for (;;) {
				const lines = loggedIn(events, cwd, session.sessionId);
				if (lines.some(match) || Date.now() > deadline) return lines;
				await new Promise((resolve) => setTimeout(resolve, 10));
			}
		},
		dispose: () => {
			session.dispose();
			restore("PI_HARNESS_EVENTS", beforeEvents);
			restore("PI_CODING_AGENT_DIR", beforeAgent);
			if (options.root === undefined) rmSync(root, { recursive: true, force: true });
		},
	};
	return rig;
}
