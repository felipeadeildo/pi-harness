// The working tree, in one call: `git status --porcelain=v2 --branch --show-stash` says how far the
// branch is from its upstream and what changed, file by file. The parse is pure so it can be tested
// against captured output.
import { execFile } from "node:child_process";

export interface GitState {
	ahead: number;
	behind: number;
	/** In the index, ready to commit. */
	staged: number;
	/** Changed in the tree and not staged. */
	modified: number;
	untracked: number;
	conflicted: number;
	stashed: number;
}

export function emptyGit(): GitState {
	return { ahead: 0, behind: 0, staged: 0, modified: 0, untracked: 0, conflicted: 0, stashed: 0 };
}

export function parseStatus(output: string): GitState {
	const state = emptyGit();

	for (const line of output.split("\n")) {
		if (line.startsWith("# branch.ab ")) {
			const [, , ahead, behind] = line.split(" ");
			state.ahead = Math.abs(Number(ahead ?? "0")) || 0;
			state.behind = Math.abs(Number(behind ?? "0")) || 0;
		} else if (line.startsWith("# stash ")) {
			state.stashed = Number(line.slice("# stash ".length)) || 0;
		} else if (line.startsWith("1 ") || line.startsWith("2 ")) {
			// `XY` is the index column, then the tree column, with `.` for unchanged.
			const index = line[2];
			const tree = line[3];
			if (index !== undefined && index !== ".") state.staged++;
			if (tree !== undefined && tree !== ".") state.modified++;
		} else if (line.startsWith("u ")) {
			state.conflicted++;
		} else if (line.startsWith("? ")) {
			state.untracked++;
		}
	}

	return state;
}

/** Undefined outside a repository, or when git is missing or slow. */
export function readGit(cwd: string): Promise<GitState | undefined> {
	return new Promise((resolve) => {
		execFile(
			"git",
			["-C", cwd, "status", "--porcelain=v2", "--branch", "--show-stash"],
			{ timeout: 2000 },
			(error, stdout) => resolve(error === null ? parseStatus(stdout) : undefined),
		);
	});
}
