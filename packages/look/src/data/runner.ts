import { execFile } from "node:child_process";

/** The start card is never worth a longer wait. */
const TIMEOUT_MS = 3000;
/** Room for a page of answers, like your open pull requests with their comments. */
const MAX_OUTPUT = 1024 * 1024;

/** Rejects when it fails or takes too long. */
export type Runner = (file: string, args: readonly string[]) => Promise<string>;

export function processRunner(cwd: string, timeoutMs: number = TIMEOUT_MS): Runner {
	return (file, args) =>
		new Promise((resolve, reject) => {
			execFile(
				file,
				[...args],
				{ cwd, timeout: timeoutMs, maxBuffer: MAX_OUTPUT },
				(error, stdout) => {
					if (error === null) resolve(stdout);
					else reject(error instanceof Error ? error : new Error(String(error)));
				},
			);
		});
}
