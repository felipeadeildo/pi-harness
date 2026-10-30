import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { ANSWER_KEY, type AnswerModel, WEB_DEFAULTS } from "./defaults.ts";

const FILE = "web-search.json";

/** Keep in step with pi-web-access's `getWebSearchConfigDir`; the contract test compares them. */
export function webSearchConfigPath(
	env: NodeJS.ProcessEnv = process.env,
	home = homedir(),
): string {
	if (env.PI_CODING_AGENT_DIR) return join(env.PI_CODING_AGENT_DIR, FILE);
	const legacy = join(home, ".pi");
	const preferred = env.XDG_CONFIG_HOME
		? join(env.XDG_CONFIG_HOME, "pi")
		: join(home, ".pi", "agent");
	if (existsSync(join(preferred, FILE))) return join(preferred, FILE);
	if (existsSync(join(legacy, FILE))) return join(legacy, FILE);
	return join(preferred, FILE);
}

export interface Applied {
	written: string[];
	answer?: AnswerModel;
	error?: string;
}

interface Decided {
	decided: string[];
	toldStandalone?: string;
}

export function readDecided(path: string): Decided {
	if (!existsSync(path)) return { decided: [] };
	const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<Decided>;
	return { ...parsed, decided: parsed.decided ?? [] };
}

export function writeDecided(path: string, decided: Decided): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(decided, null, "\t")}\n`);
}

/**
 * Each default is written once, and only where the file has no value of its own: a key the person
 * set, or later removed, stays theirs.
 */
export function applyDefaults(
	configPath: string,
	decidedPath: string,
	answer: AnswerModel | undefined,
): Applied {
	let config: Record<string, unknown> = {};
	if (existsSync(configPath)) {
		try {
			const parsed: unknown = JSON.parse(readFileSync(configPath, "utf8"));
			if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
				return { written: [], error: `${configPath} is not a JSON object` };
			config = parsed as Record<string, unknown>;
		} catch {
			return { written: [], error: `${configPath} is not valid JSON` };
		}
	}

	const state = readDecided(decidedPath);
	const decided = new Set(state.decided);
	const written: string[] = [];

	for (const { key, value } of WEB_DEFAULTS) {
		if (decided.has(key)) continue;
		decided.add(key);
		if (Object.hasOwn(config, key)) continue;
		config[key] = value;
		written.push(key);
	}

	let chosen: AnswerModel | undefined;
	if (!decided.has(ANSWER_KEY)) {
		const fetch = isObject(config.fetch) ? config.fetch : {};
		if (Object.hasOwn(fetch, "answerProvider") || Object.hasOwn(fetch, "answerModel")) {
			decided.add(ANSWER_KEY);
		} else if (answer !== undefined) {
			config.fetch = { ...fetch, answerProvider: answer.provider, answerModel: answer.model };
			decided.add(ANSWER_KEY);
			written.push(ANSWER_KEY);
			chosen = answer;
		}
	}

	if (written.length > 0) {
		mkdirSync(dirname(configPath), { recursive: true });
		writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
	}
	if (decided.size !== state.decided.length)
		writeDecided(decidedPath, { ...state, decided: [...decided] });
	return { written, ...(chosen === undefined ? {} : { answer: chosen }) };
}

function isObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
