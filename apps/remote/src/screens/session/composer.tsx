import type {
	CommandMap,
	CommandType,
	ModelOption,
	PermissionMode,
} from "@adeildo/pi-remote-protocol";
// The controls under the transcript, in the order a thumb reaches them: the lists above, then one strip
// of pickers (mode, thinking, model), then the field with its one filled button. Two strips at rest.
// Each picker shows its value and opens a sheet; the acts that do not belong to every moment sit behind
// an overflow control, so the screen does not grow when a run starts. What each control decides lives
// in `composer-data.ts`; this file wires it.
import type { Client, Outgoing } from "@adeildo/pi-remote-protocol/client";
import { type ReactNode, useEffect, useState } from "react";
import {
	KeyboardAvoidingView,
	Platform,
	Pressable,
	ScrollView,
	Text,
	TextInput,
	type TextStyle,
	View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Action, Option, Primary, Trigger } from "../../ui/controls.tsx";
import { Sheet } from "../../ui/sheet.tsx";
import { HIT, type Theme } from "../../ui/theme.ts";
import { useTheme } from "../../ui/use-theme.ts";
import {
	dropNow,
	levelChoices,
	type MenuItem,
	menuItems,
	modeChoices,
	isCurrentModel,
	matchModels,
	modelLabel,
	modelsNote,
	outboxLine,
	primaryAct,
	sendNow,
	takeDraft,
} from "./composer-data.ts";
import { type ComposerView } from "./live.ts";
import { type QueuedLine, queuedLines, withdraw } from "./pending.ts";
import { chosen, suggested, type Suggestion } from "./suggestions.ts";

type Send = <K extends CommandType>(type: K, data: CommandMap[K]) => void;

export interface ComposerProps {
	/** The connection this session is drawn from, which is also where commands go. */
	client: Client;
	/** What the session is now, built from its state in one place. */
	view: ComposerView;
	/** Called when a control needs a value from the person, as rename does. */
	ask?: (question: string) => string | undefined;
	/** What the field starts with: a draft restored from the cache. */
	initialDraft?: string;
}

/** What a text field looks like, the prompt and the model search alike. */
function fieldStyle(theme: Theme): TextStyle {
	return {
		...theme.type.body,
		minHeight: theme.hit,
		paddingHorizontal: theme.space(4),
		borderWidth: theme.line.hairline,
		borderColor: theme.color.border,
		borderRadius: theme.radius(1),
		color: theme.color.text,
	};
}

/** How tall the lists above the field may grow before they scroll, in points. */
const LISTS_MAX = HIT * 3;

export function Composer({ client, view, ask, initialDraft }: ComposerProps): ReactNode {
	const { waiting, commands, running } = view;
	const theme = useTheme();
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
	const heldIds = new Set(
		client
			.outbox()
			.held()
			.map((command) => command.id),
	);
	const offering = suggested(draft, commands ?? []);
	const lines = queuedLines(waiting ?? []);
	const outbox = client.outbox().all();

	const act = primaryAct(running, empty);
	const menu = menuItems({ running, empty, canRename: ask !== undefined });
	const runMenu = (id: MenuItem["id"]): void => {
		switch (id) {
			case "steer":
				return take("steer");
			case "abort":
				return send("run.abort", {});
			case "compact":
				return send("session.compact", {});
			case "stop":
				return send("session.stop", {});
			case "rename": {
				const name = ask?.("Name this session")?.trim();
				if (name !== undefined && name !== "") send("session.rename", { name });
				return;
			}
			default: {
				// A menu id with no case is a button that does nothing: the compiler says so here.
				const unhandled: never = id;
				return unhandled;
			}
		}
	};

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
						<Outbox queue={outbox} heldIds={heldIds} client={client} />
						<QueueRows lines={lines} client={client} />
					</ScrollView>
				)}
				<Pickers send={send} view={view} />
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
							style={fieldStyle(theme)}
						/>
					</View>
					<Overflow items={menu} onPick={runMenu} />
					{act === "abort" ? (
						<Primary danger label="Abort" onPress={() => send("run.abort", {})} />
					) : (
						<Primary label="Send" disabled={empty} onPress={() => take("followUp")} />
					)}
				</View>
			</View>
		</KeyboardAvoidingView>
	);
}

/** The acts behind one control: the same rows every time, the ones that cannot mean anything dimmed. */
function Overflow({
	items,
	onPick,
}: {
	items: readonly MenuItem[];
	onPick: (id: MenuItem["id"]) => void;
}): ReactNode {
	const [open, setOpen] = useState(false);
	return (
		<>
			<Action label="More" icon="more" onPress={() => setOpen(true)} />
			{open ? (
				<Sheet title="More" onClose={() => setOpen(false)}>
					{items.map((item) => (
						<Action
							key={item.id}
							label={item.label}
							disabled={!item.enabled}
							onPress={() => {
								setOpen(false);
								onPick(item.id);
							}}
						/>
					))}
				</Sheet>
			) : null}
		</>
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
	const theme = useTheme();
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
	const theme = useTheme();
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

function Pickers({ send, view }: { send: Send; view: ComposerView }): ReactNode {
	const { mode, serves, model, models, modelsTotal, thinking } = view;
	const theme = useTheme();
	const [open, setOpen] = useState<"mode" | "thinking" | "model" | undefined>(undefined);
	const modes = modeChoices(mode, serves);
	const levels = levelChoices(thinking);
	const current = (list: readonly { value: string; chosen: boolean }[]): string =>
		list.find((one) => one.chosen)?.value ?? "";
	return (
		<View style={{ flexDirection: "row", gap: theme.space(3) }}>
			{modes.length === 0 ? null : (
				<Trigger title="Permission mode" value={current(modes)} onPress={() => setOpen("mode")} />
			)}
			<Trigger title="Thinking" value={current(levels)} onPress={() => setOpen("thinking")} />
			<Trigger
				title="Model"
				value={modelLabel(model)}
				// Only a list that has something to pick opens: an absent list is not said yet, and an
				// empty one has nothing to offer, so neither is a button that opens an empty sheet.
				onPress={models === undefined || models.length === 0 ? undefined : () => setOpen("model")}
			/>
			{open === "model" && models !== undefined ? (
				<ModelSheet
					models={models}
					total={modelsTotal}
					current={model}
					onClose={() => setOpen(undefined)}
					onPick={(picked) => {
						setOpen(undefined);
						send("model.set", { provider: picked.provider, id: picked.id });
					}}
				/>
			) : null}
			{open === undefined || open === "model" ? null : (
				<Sheet
					title={open === "mode" ? "Permission mode" : "Thinking"}
					onClose={() => setOpen(undefined)}
				>
					{(open === "mode" ? modes : levels).map((one) => (
						<Option
							key={one.value}
							label={one.value}
							hint={"hint" in one ? one.hint : undefined}
							chosen={one.chosen}
							onPress={() => {
								setOpen(undefined);
								if (open === "mode") send("mode.set", { mode: one.value as PermissionMode });
								else send("thinking.set", { level: one.value });
							}}
						/>
					))}
				</Sheet>
			)}
		</View>
	);
}

/** What this device sent and the daemon has not settled, with the two acts a held command allows. */
function Outbox({
	queue,
	heldIds,
	client,
}: {
	queue: readonly Outgoing[];
	heldIds: ReadonlySet<string>;
	client: Client;
}): ReactNode {
	const theme = useTheme();
	return (
		<>
			{queue.map((command) => {
				const line = outboxLine(command, heldIds);
				return (
					<View
						key={command.id}
						testID="outbox-row"
						style={{ gap: theme.space(1), paddingVertical: theme.space(2) }}
					>
						<Text style={{ ...theme.type.label, color: theme.color.text }}>{command.type}</Text>
						<Text style={{ ...theme.type.caption, color: theme.color.muted }}>{line.text}</Text>
						{line.actionable ? (
							<View style={{ flexDirection: "row", gap: theme.space(3) }}>
								<Action label="Send now" onPress={() => sendNow(client, command.id)} />
								<Action label="Drop" onPress={() => dropNow(client, command.id)} />
							</View>
						) : null}
					</View>
				);
			})}
		</>
	);
}

/** The session's own queue, in the order it will run: two phones see the same lines. */
function QueueRows({ lines, client }: { lines: readonly QueuedLine[]; client: Client }): ReactNode {
	const theme = useTheme();
	return (
		<>
			{lines.map((line) => (
				<View
					key={line.id}
					testID="held-row"
					nativeID={line.id}
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

/** The models the session could switch to, with a search: a registry is long, and a row each is a scroll. */
function ModelSheet({
	models,
	total,
	current,
	onClose,
	onPick,
}: {
	models: readonly ModelOption[];
	total: number | undefined;
	current: { provider: string; id: string } | undefined;
	onClose: () => void;
	onPick: (model: ModelOption) => void;
}): ReactNode {
	const theme = useTheme();
	const [query, setQuery] = useState("");
	const shown = matchModels(models, query);
	const note = modelsNote(models.length, total);
	return (
		<Sheet title="Model" onClose={onClose}>
			<TextInput
				aria-label="Search models"
				placeholder="Search models"
				placeholderTextColor={theme.color.faint}
				value={query}
				onChangeText={setQuery}
				style={fieldStyle(theme)}
			/>
			{note === undefined ? null : (
				<Text style={{ ...theme.type.caption, color: theme.color.muted, padding: theme.space(2) }}>
					{note}
				</Text>
			)}
			{shown.length === 0 ? (
				<Text style={{ ...theme.type.body, color: theme.color.muted, padding: theme.space(4) }}>
					No model matches
				</Text>
			) : (
				shown.map((model) => (
					<Option
						key={`${model.provider}/${model.id}`}
						label={model.name}
						hint={`${model.provider}/${model.id}`}
						chosen={isCurrentModel(model, current)}
						onPress={() => onPick(model)}
					/>
				))
			)}
		</Sheet>
	);
}
