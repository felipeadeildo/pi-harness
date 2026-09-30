import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Points the agent dir at a fresh temp folder, so the store's default path lands there. */
export function agentDirFixture(prefix: string): { dir: string; restore: () => void } {
	const previous = process.env.PI_CODING_AGENT_DIR;
	const dir = mkdtempSync(join(tmpdir(), prefix));
	process.env.PI_CODING_AGENT_DIR = dir;
	return {
		dir,
		restore: () => {
			if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = previous;
			rmSync(dir, { recursive: true, force: true });
		},
	};
}
