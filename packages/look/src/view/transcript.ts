// Another session's entries, built as pi's interactive mode builds a loaded session.
import { messageRendererFor, resolveToolRenderers } from "@adeildo/pi-kit";
import {
	AssistantMessageComponent,
	BashExecutionComponent,
	BranchSummaryMessageComponent,
	buildSessionContext,
	CompactionSummaryMessageComponent,
	createBashToolDefinition,
	createEditToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
	CustomMessageComponent,
	getMarkdownTheme,
	parseSkillBlock,
	type SessionEntry,
	SkillInvocationMessageComponent,
	ToolExecutionComponent,
	type ToolRenderers,
	UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import { type Component, Spacer, type TUI } from "@earendil-works/pi-tui";

type AgentMessage = ReturnType<typeof buildSessionContext>["messages"][number];
type Truncation = Parameters<BashExecutionComponent["setComplete"]>[2];
type UserContent = Extract<AgentMessage, { role: "user" }>["content"];

const BUILT_IN = {
	bash: createBashToolDefinition,
	read: createReadToolDefinition,
	edit: createEditToolDefinition,
	write: createWriteToolDefinition,
	grep: createGrepToolDefinition,
	find: createFindToolDefinition,
	ls: createLsToolDefinition,
};

export interface TranscriptOptions {
	tui: TUI;
	/** Pi's tools show paths against it. */
	cwd: string;
	/** As `ctrl+o` does in pi. */
	expanded: boolean;
}

export function transcriptOf(
	entries: readonly SessionEntry[],
	leafId: string | undefined,
	options: TranscriptOptions,
): Component[] {
	const { messages } = buildSessionContext([...entries], leafId ?? entries.at(-1)?.id ?? null);
	const theme = getMarkdownTheme();
	const components: Component[] = [];
	const calls = new Map<string, ToolExecutionComponent>();

	for (const message of messages) {
		switch (message.role) {
			case "user": {
				const text = textOf(message.content);
				if (text === "") break;
				if (components.length > 0) components.push(new Spacer(1));
				const skill = parseSkillBlock(text);
				if (skill === null) {
					components.push(new UserMessageComponent(text, theme));
					break;
				}
				components.push(expand(new SkillInvocationMessageComponent(skill, theme), options));
				if (skill.userMessage) {
					components.push(new Spacer(1), new UserMessageComponent(skill.userMessage, theme));
				}
				break;
			}
			case "assistant": {
				components.push(new AssistantMessageComponent(message, false, theme));
				const failed = message.stopReason === "aborted" || message.stopReason === "error";
				for (const content of message.content) {
					if (content.type !== "toolCall") continue;
					const call = new ToolExecutionComponent(
						content.name,
						content.id,
						content.arguments,
						undefined,
						renderersOf(content.name, options.cwd),
						options.tui,
						options.cwd,
					);
					call.setExpanded(options.expanded);
					components.push(call);
					if (!failed) {
						calls.set(content.id, call);
						continue;
					}
					const text =
						message.stopReason === "aborted"
							? "Operation aborted"
							: (message.errorMessage ?? "Error");
					call.updateResult({ content: [{ type: "text", text }], isError: true });
				}
				break;
			}
			case "toolResult":
				calls.get(message.toolCallId)?.updateResult(message);
				calls.delete(message.toolCallId);
				break;
			case "bashExecution": {
				const bash = new BashExecutionComponent(
					message.command,
					options.tui,
					message.excludeFromContext,
				);
				if (message.output) bash.appendOutput(message.output);
				bash.setComplete(
					message.exitCode,
					message.cancelled,
					// Pi hands the same partial result when it loads a session: the component reads `truncated` only.
					message.truncated ? ({ truncated: true } as Truncation) : undefined,
					message.fullOutputPath,
				);
				components.push(bash);
				break;
			}
			case "custom":
				if (!message.display) break;
				components.push(
					expand(
						new CustomMessageComponent(message, messageRendererFor(message.customType), theme),
						options,
					),
				);
				break;
			case "compactionSummary":
				components.push(
					new Spacer(1),
					expand(new CompactionSummaryMessageComponent(message, theme), options),
				);
				break;
			case "branchSummary":
				components.push(
					new Spacer(1),
					expand(new BranchSummaryMessageComponent(message, theme), options),
				);
				break;
			default:
				break;
		}
	}
	return components;
}

/** Under the ones the harness registered. */
function renderersOf(name: string, cwd: string): ToolRenderers | undefined {
	return resolveToolRenderers(name, () => {
		if (!Object.hasOwn(BUILT_IN, name)) return undefined;
		return BUILT_IN[name as keyof typeof BUILT_IN](cwd) as ToolRenderers;
	});
}

function expand<T extends { setExpanded(expanded: boolean): void }>(
	component: T,
	options: TranscriptOptions,
): T {
	component.setExpanded(options.expanded);
	return component;
}

function textOf(content: UserContent): string {
	if (typeof content === "string") return content;
	return content
		.flatMap((part) => (part.type === "text" ? [part.text] : []))
		.join("\n")
		.trim();
}
