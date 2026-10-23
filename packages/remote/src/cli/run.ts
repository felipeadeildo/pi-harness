// `pi-remote`, the command the launcher runs. It grows a subcommand with each slice of the remote,
// and until a subcommand exists it says so instead of guessing.
import { VERSION } from "../version.ts";

const USAGE = "usage: pi-remote --version";

/** Runs one command line and returns the exit code. */
export function run(
	args: readonly string[],
	out: (line: string) => void,
	err: (line: string) => void,
): number {
	const [first] = args;
	if (first === "--version" || first === "-v") {
		out(VERSION);
		return 0;
	}
	err(first === undefined ? USAGE : `pi-remote: unknown command "${first}"\n${USAGE}`);
	return 2;
}
