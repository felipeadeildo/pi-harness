import {
	getMarkdownTheme,
	type MessageRenderer,
	parseSkillBlock,
	SkillInvocationMessageComponent,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import { type Component, Container, Spacer } from "@earendil-works/pi-tui";

type SkillsMessage = Parameters<MessageRenderer>[0];

const NBSP = "\u00a0";

/** A skill where you typed it, drawn as pi draws a folded skill: `[skill] name`. */
export function chip(theme: Theme, name: string): string {
	const label = theme.fg("customMessageLabel", "\x1b[1m[skill]\x1b[22m");
	const inside = `${NBSP}${label}${NBSP}${theme.fg("customMessageText", name)}${NBSP}`;
	// The line keeps its own colors after the chip.
	return (
		theme.bg("customMessageBg", inside) +
		theme.getBgAnsi("userMessageBg") +
		theme.getFgAnsi("userMessageText")
	);
}

/** Nothing until the tool output expands, then each skill in full, as pi shows one. */
export function renderSkills(message: SkillsMessage, expanded: boolean): Component {
	const shown = new Container();
	if (!expanded) return shown;

	for (const text of textsOf(message)) {
		const block = parseSkillBlock(text);
		if (block === null) continue;
		if (shown.children.length > 0) shown.addChild(new Spacer(1));
		const skill = new SkillInvocationMessageComponent(block, getMarkdownTheme());
		skill.setExpanded(true);
		shown.addChild(skill);
	}
	return shown;
}

function textsOf(message: SkillsMessage): string[] {
	if (typeof message.content === "string") return [message.content];
	return message.content.flatMap((part) => (part.type === "text" ? [part.text] : []));
}
