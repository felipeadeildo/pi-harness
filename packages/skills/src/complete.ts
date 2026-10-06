// Lists the skills after a `/` anywhere past the start of a message, where pi's palette does not.
import { SKILL_REF, skillQueryAt } from "@adeildo/pi-kit";
import {
	type AutocompleteItem,
	type AutocompleteProvider,
	fuzzyFilter,
} from "@earendil-works/pi-tui";

import type { Skill } from "./skills.ts";

export function completeSkills(
	current: AutocompleteProvider,
	skills: () => readonly Skill[],
): AutocompleteProvider {
	return {
		triggerCharacters: current.triggerCharacters,

		async getSuggestions(lines, cursorLine, cursorCol, options) {
			const typing = skillQueryAt(lines, cursorLine, cursorCol);
			if (typing !== undefined) {
				const items = matching(skills(), typing.query);
				if (items.length > 0) return { items, prefix: typing.typed };
			}
			return current.getSuggestions(lines, cursorLine, cursorCol, options);
		},

		applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
			if (!item.value.startsWith(SKILL_REF) || !prefix.startsWith("/"))
				return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);

			const line = lines[cursorLine] ?? "";
			const start = cursorCol - prefix.length;
			const rest = line.slice(cursorCol);
			const after = rest.startsWith(" ") ? rest : ` ${rest}`;
			return {
				lines: lines.with(cursorLine, line.slice(0, start) + item.value + after),
				cursorLine,
				cursorCol: start + item.value.length + 1,
			};
		},

		shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
			if (skillQueryAt(lines, cursorLine, cursorCol) !== undefined) return true;
			return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
		},
	};
}

/** As pi's palette matches: by the bare name first, then by `skill:name`. */
function matching(skills: readonly Skill[], query: string): AutocompleteItem[] {
	const byName = fuzzyFilter([...skills], query, (skill) => skill.name);
	const byRef = fuzzyFilter(
		skills.filter((skill) => !byName.includes(skill)),
		query,
		(skill) => `skill:${skill.name}`,
	);
	return [...byName, ...byRef].map((skill) => ({
		value: `${SKILL_REF}${skill.name}`,
		label: `skill:${skill.name}`,
		description: skill.description,
	}));
}
