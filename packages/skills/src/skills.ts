import { readFileSync } from "node:fs";
import { dirname } from "node:path";

import { type ExtensionAPI, stripFrontmatter } from "@earendil-works/pi-coding-agent";

export interface Skill {
	name: string;
	description?: string;
	filePath: string;
}

const PREFIX = "skill:";

/** The skills pi loaded for this session, which `/skill:` can name. */
export function loadedSkills(pi: Pick<ExtensionAPI, "getCommands">): Skill[] {
	return pi
		.getCommands()
		.filter((command) => command.source === "skill" && command.name.startsWith(PREFIX))
		.map((command) => ({
			name: command.name.slice(PREFIX.length),
			description: command.description,
			filePath: command.sourceInfo.path,
		}));
}

/** The skill as the model reads it, in the block pi writes for `/skill:name`. */
export function skillBlock(skill: Skill): string {
	const body = stripFrontmatter(readFileSync(skill.filePath, "utf8")).trim();
	return `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${dirname(skill.filePath)}.\n\n${body}\n</skill>`;
}
