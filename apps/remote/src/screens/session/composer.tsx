// The controls under the transcript, in the order a thumb reaches them: the field and the one filled
// button on the first row, the session's pickers on the second, the quiet actions on the third. The
// queues sit above them in a box of bounded height, so a message that arrives never pushes the
// conversation. What each control decides lives in `composer-data.ts`; this file wires it.
import type { Client, Outgoing } from "@adeildo/pi-remote-client";
import type {
	CommandMap,
	CommandType,
	PermissionMode,
	QueuedMessage,
	SessionCommand,
} from "@adeildo/pi-remote-protocol";
import { type ReactNode, useEffect, useState } from "react";
import {
	KeyboardAvoidingView,
	Platform,
	Pressable,
	ScrollView,
	Text,
	TextInput,
	View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Action, Chip, Primary } from "../../ui/controls.tsx";
import { theme } from "../../ui/theme.ts";
import {
	dropNow,
	levelChoices,
	modeChoices,
	modelLabel,
	outboxLine,
	sendNow,
	takeDraft,
} from "./composer-data.ts";
import { type QueuedLine, queuedLines, withdraw } from "./pending.ts";
import { chosen, suggested, type Suggestion } from "./suggestions.ts";

type Send = <K extends CommandType>(type: K, data: CommandMap[K]) => void;

export interface ComposerProps {
	/** The connection this session is drawn from, which is also where commands go. */
	client: Client;
	/** The permission mode, model and thinking the session is on now, as its state says. */
	mode?: PermissionMode;
	model?: { provider: string; id: string };
	thinking?: string;
	/** Called when a control needs a value from the person, as rename does. */
	ask?: (question: string) => string | undefined;
	/** What the session is holding for the agent to finish, which every client sees the same way. */
	waiting?: readonly QueuedMessage[];
	/** What a phone may run by typing `/`, as the session last said. Nothing here, nothing offered. */
	commands?: SessionCommand[];
	/** Whether the session takes `mode.set`. */
	serves?: boolean;
	/** What the field starts with: a draft restored from the cache. */
	initialDraft?: string;
}

/** How tall the lists above the field may grow before they scroll, in points. */
const LISTS_MAX = theme.hit * 3;

export function Composer({
	client,
	mode,
	model,
	thinking,
	ask,
	waiting,
	commands,
	serves,
	initialDraft,
}: ComposerProps): ReactNode {
	// The queue changes without the session changing, so the composer hears the client itself.
	const [, redraw] = useState(0);
	useEffect(() => client.on(() => redraw((count) => count + 1)), [client]);
	const [draft, write] = useState(initialDraft ?? "");
	const inset = useSafeAreaInsets().bottom;

	const send: Send = (type, data) => {
		client.send(type, data);
	};
	const take = (deliverAs: "steer" | "followUp"): void =>
		takeDraft(send, draft, () => write(""), deliverAs);
	const empty = draft.trim() === "";
	// A command past the window waits for the person, and one inside it goes out on its own.
	const held = new Set(
		client
			.outbox()
			.held()
			.map((command) => command.id),
	);
	const offering = suggested(draft, commands ?? []);
	const lines = queuedLines(waiting ?? []);
	const outbox = client.outbox().all();

	return (
		<KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
			<View
				testID="composer"
				style={{
					gap: theme.space(3),
					padding: theme.space(4),
					paddingBottom: theme.space(4) + inset,
					borderTopWidth: theme.line.hairline,
					borderColor: theme.color.border,
					backgroundColor: theme.color.background,
				}}
			>
				{outbox.length === 0 && lines.length === 0 ? null : (
					<ScrollView testID="lists" style={{ maxHeight: LISTS_MAX }}>
						<Outbox queue={outbox} held={held} client={client} />
						<Held lines={lines} client={client} />
					</ScrollView>
				)}
				<View style={{ flexDirection: "row", gap: theme.space(3), alignItems: "center" }}>
					<View style={{ flex: 1 }}>
						<Suggestions offering={offering} write={write} />
						<TextInput
							aria-label="Prompt"
							placeholder="Write to the session"
							placeholderTextColor={theme.color.faint}
							value={draft}
							onChangeText={write}
							returnKeyType="send"
							onSubmitEditing={() => take("followUp")}
							blurOnSubmit={false}
							style={{
								...theme.type.body,
								minHeight: theme.hit,
								paddingHorizontal: theme.space(4),
								borderWidth: theme.line.hairline,
								borderColor: theme.color.border,
								borderRadius: theme.radius(1),
								color: theme.color.text,
							}}
						/>
					</View>
					<Primary label="Send" disabled={empty} onPress={() => take("followUp")} />
				</View>
				<Pickers send={send} mode={mode} serves={serves} model={model} thinking={thinking} />
				<ScrollView horizontal showsHorizontalScrollIndicator={false}>
					<View style={{ flexDirection: "row", gap: theme.space(3) }}>
						<Action label="Steer now" disabled={empty} onPress={() => take("steer")} />
						<Action label="Abort" onPress={() => send("run.abort", {})} />
						<Action label="Compact" onPress={() => send("session.compact", {})} />
						<Action label="Stop" onPress={() => send("session.stop", {})} />
						{ask === undefined ? null : (
							<Action
								label="Rename"
								onPress={() => {
									const name = ask("Name this session")?.trim();
									if (name !== undefined && name !== "") send("session.rename", { name });
								}}
							/>
						)}
					</View>
				</ScrollView>
			</View>
		</KeyboardAvoidingView>
	);
}

/**
 * What `/` offers, drawn over the transcript's edge and not in the flow: the list opens above the field
 * and the conversation stays where it was. Choosing one writes the command and keeps the field.
 */
function Suggestions({
	offering,
	write,
}: {
	offering: readonly Suggestion[];
	write: (text: string) => void;
}): ReactNode {
	if (offering.length === 0) return null;
	return (
		<View
			testID="suggestions"
			style={{
				position: "absolute",
				bottom: "100%",
				left: 0,
				right: 0,
				maxHeight: LISTS_MAX,
				marginBottom: theme.space(2),
				borderWidth: theme.line.hairline,
				borderColor: theme.color.border,
				borderRadius: theme.radius(1),
				backgroundColor: theme.color.elevated,
			}}
		>
			<ScrollView keyboardShouldPersistTaps="handled">
				{offering.map((one) => (
					<Row key={one.name} label={one.name} onPress={() => write(chosen(one.name))}>
						<Text style={{ ...theme.type.label, color: theme.color.text }}>{one.name}</Text>
						{one.description === undefined ? null : (
							<Text style={{ ...theme.type.caption, color: theme.color.muted }}>
								{one.description}
							</Text>
						)}
					</Row>
				))}
			</ScrollView>
		</View>
	);
}

function Row({
	label,
	onPress,
	children,
}: {
	label: string;
	onPress: () => void;
	children: ReactNode;
}): ReactNode {
	return (
		<Pressable
			role="button"
			aria-label={label}
			onPress={onPress}
			style={{
				minHeight: theme.hit,
				paddingHorizontal: theme.space(4),
				paddingVertical: theme.space(2),
				justifyContent: "center",
			}}
		>
			{children}
		</Pressable>
	);
}

function Pickers({
	send,
	mode,
	serves,
	model,
	thinking,
}: {
	send: Send;
	mode: PermissionMode | undefined;
	serves: boolean | undefined;
	model: { provider: string; id: string } | undefined;
	thinking: string | undefined;
}): ReactNode {
	const modes = modeChoices(mode, serves);
	const named = model === undefined ? null : modelLabel(model);
	return (
		<View style={{ gap: theme.space(2) }}>
			{/* One row for both pickers: the mode and the thinking are the two a person changes mid-run, and
			    two rows of chips took a third of a phone's height from the conversation. */}
			<ScrollView horizontal showsHorizontalScrollIndicator={false}>
				<View style={{ flexDirection: "row", gap: theme.space(5) }}>
					{modes.length === 0 ? null : (
						<View
							role="radiogroup"
							aria-label="Permission mode"
							style={{ flexDirection: "row", gap: theme.space(3) }}
						>
							{modes.map((one) => (
								<Chip
									key={one.value}
									label={one.value}
									hint={one.hint}
									chosen={one.chosen}
									onPress={() => send("mode.set", { mode: one.value })}
								/>
							))}
						</View>
					)}
					<View
						role="radiogroup"
						aria-label="Thinking"
						style={{ flexDirection: "row", gap: theme.space(3) }}
					>
						{levelChoices(thinking).map((one) => (
							<Chip
								key={one.value}
								label={one.value}
								chosen={one.chosen}
								onPress={() => send("thinking.set", { level: one.value })}
							/>
						))}
					</View>
				</View>
			</ScrollView>
			{named === null ? null : (
				<Text style={{ ...theme.type.caption, color: theme.color.muted }}>{named}</Text>
			)}
		</View>
	);
}

/** What this device sent and the daemon has not settled, with the two acts a held command allows. */
function Outbox({
	queue,
	held,
	client,
}: {
	queue: readonly Outgoing[];
	held: ReadonlySet<string>;
	client: Client;
}): ReactNode {
	return (
		<>
			{queue.map((command) => (
				<View
					key={command.id}
					testID="outbox-row"
					style={{ gap: theme.space(1), paddingVertical: theme.space(2) }}
				>
					<Text style={{ ...theme.type.label, color: theme.color.text }}>{command.type}</Text>
					<Text style={{ ...theme.type.caption, color: theme.color.muted }}>
						{outboxLine(command, held).text}
					</Text>
					{outboxLine(command, held).actionable ? (
						<View style={{ flexDirection: "row", gap: theme.space(3) }}>
							<Action label="Send now" onPress={() => sendNow(client, command.id)} />
							<Action label="Drop" onPress={() => dropNow(client, command.id)} />
						</View>
					) : null}
				</View>
			))}
		</>
	);
}

/** The session's own queue, in the order it will run: two phones see the same lines. */
function Held({ lines, client }: { lines: readonly QueuedLine[]; client: Client }): ReactNode {
	return (
		<>
			{lines.map((line) => (
				<View
					key={line.id}
					testID="held-row"
					style={{ flexDirection: "row", alignItems: "center", gap: theme.space(3) }}
				>
					<View style={{ flex: 1 }}>
						<Text testID="held-text" style={{ ...theme.type.body, color: theme.color.text }}>
							{line.text}
						</Text>
						<Text style={{ ...theme.type.caption, color: theme.color.muted }}>{line.by}</Text>
					</View>
					<Action label="Withdraw" onPress={() => withdraw(client, line.id)} />
				</View>
			))}
		</>
	);
}
