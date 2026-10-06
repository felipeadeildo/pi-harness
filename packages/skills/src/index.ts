import {
	addSkillNames,
	createApp,
	defineFeature,
	drawSkillRefs,
	type FeatureScope,
	referencedSkills,
	SKILL_NAMES,
	SKILL_REF,
} from "@adeildo/pi-kit";
import type { TextContent } from "@earendil-works/pi-ai";
import type {
	ExtensionAPI,
	ExtensionContext,
	InputEvent,
	InputEventResult,
} from "@earendil-works/pi-coding-agent";

import { completeSkills } from "./complete.ts";
import { chip, renderSkills } from "./render.ts";
import { loadedSkills, type Skill, skillBlock } from "./skills.ts";

export { loadedSkills, skillBlock, type Skill } from "./skills.ts";

/** The message that carries the skills a message named, right before it. */
export const SKILLS_MESSAGE = "pi-skills";

export const skills = defineFeature({
	id: "skills",
	description: "Call the skills you already have from anywhere in a message, several at once",
	setup(scope) {
		let session: ExtensionContext | undefined;

		scope.onSessionStart((ctx) => {
			session = ctx;
			if (ctx.mode === "tui")
				ctx.ui.addAutocompleteProvider((current) =>
					completeSkills(current, () => loadedSkills(scope)),
				);
		});
		scope.onShutdown(() => {
			session = undefined;
		});

		scope.events.on(SKILL_NAMES, (data: unknown) => addSkillNames(data, namesOf(scope)));

		scope.on("input", (event, ctx) => expand(scope, ctx, event));

		scope.registerMessageRenderer(SKILLS_MESSAGE, (message, options) =>
			renderSkills(message, options.expanded),
		);

		scope.registerMarkdownTransformer((markdown, context) => {
			const theme = session?.mode === "tui" ? session.ui.theme : undefined;
			if (context.messageType !== "user" || theme === undefined) return markdown;
			const typed = markdown.startsWith(` ${SKILL_REF}`) ? markdown.slice(1) : markdown;
			return drawSkillRefs(typed, namesOf(scope), (name) => chip(theme, name));
		});
	},
});

/**
 * The skills the message names go first, in one message the model reads and the chat folds. The
 * text stays as you typed it, but for a space before a leading `/skill:`, which keeps pi from
 * expanding that one again. Markdown does not draw the space.
 */
function expand(
	scope: FeatureScope,
	ctx: ExtensionContext,
	event: InputEvent,
): InputEventResult | undefined {
	const loaded = loadedSkills(scope);
	const named = referencedSkills(
		event.text,
		loaded.map((skill) => skill.name),
	);
	const blocks = named.flatMap((name) => blockOf(ctx, loaded, name));
	if (blocks.length === 0) return undefined;

	scope.sendMessage(
		{ customType: SKILLS_MESSAGE, content: blocks, display: true, details: { skills: named } },
		event.streamingBehavior && { deliverAs: event.streamingBehavior },
	);
	if (!event.text.startsWith(SKILL_REF)) return undefined;
	return { action: "transform", text: ` ${event.text}` };
}

function blockOf(ctx: ExtensionContext, loaded: readonly Skill[], name: string): TextContent[] {
	const skill = loaded.find((entry) => entry.name === name);
	if (skill === undefined) return [];
	try {
		return [{ type: "text", text: skillBlock(skill) }];
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		ctx.ui.notify(`pi-skills: could not read ${name}: ${reason}`, "warning");
		return [];
	}
}

function namesOf(pi: Pick<ExtensionAPI, "getCommands">): string[] {
	return loadedSkills(pi).map((skill) => skill.name);
}

export default function piSkills(pi: ExtensionAPI): void {
	createApp(pi, { name: "pi-skills" }).use(skills).build();
}
