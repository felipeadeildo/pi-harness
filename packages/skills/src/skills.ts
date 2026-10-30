import { readFileSync } from "node:fs";
import { basename, dirname } from "node:path";

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

/**
 * What the system prompt says in place of pi's list of skills, which costs every request a
 * description per skill: where the skills are, so the model finds one when the user asks.
 */
export function unlistedSection(skills: readonly Skill[]): string {
	const roots = [
		...new Set(
			skills.map((skill) =>
				basename(skill.filePath) === "SKILL.md"
					? dirname(dirname(skill.filePath))
					: dirname(skill.filePath),
			),
		),
	];
	return `Skills are not listed here. The user calls one with /skill:name, which hands you its text. When the user asks you to find or use a skill, look under ${roots.join(", ")}: each skill is a folder with a SKILL.md, whose frontmatter description says when it applies. Read the whole file before following it.`;
}
