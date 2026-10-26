// Under the transcript: what waits to be delivered, then the field with its pickers and its button.
// What each control decides lives in `session/composer-data.ts`.
import type {
	CommandMap,
	CommandType,
	ModelOption,
	PermissionMode,
	SessionCommand,
} from "@adeildo/pi-remote-protocol";
import type { Client, Outgoing } from "@adeildo/pi-remote-protocol/client";
import {
	ArrowRight01Icon,
	ArrowTurnBackwardIcon,
	ArrowUp02Icon,
	BookOpen02Icon,
	Cancel01Icon,
	Clock01Icon,
	CommandLineIcon,
	FlashIcon,
	Note01Icon,
	PlusSignIcon,
	Search01Icon,
	SquareIcon,
	Tick02Icon,
	UserIcon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import { cn } from "cn";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
	dropNow,
	isCurrentModel,
	levelChoices,
	matchModels,
	modeChoices,
	modelLabel,
	modelsNote,
	outboxLine,
	primaryAct,
	sendNow,
	takeDraft,
} from "@/session/composer-data.ts";
import type { ComposerView } from "@/session/live.ts";
import { queuedLines, withdraw } from "@/session/pending.ts";
import {
	insertAt,
	marked,
	matchCommands,
	type Mentionable,
	type Suggestion,
	suggestedAt,
	withCommand,
} from "@/session/suggestions.ts";

import { Icon, Panel } from "./kit.tsx";

type Send = <K extends CommandType>(type: K, data: CommandMap[K]) => void;

export function Composer({
	client,
	view,
	name,
	agents,
	ask,
}: {
	client: Client;
	view: ComposerView;
	/** Whom the field writes to, in its placeholder. */
	name: string;
	/** Who an `@` reaches. */
	agents: readonly Mentionable[];
	ask?: (question: string) => string | undefined;
}): ReactNode {
	const { waiting, running } = view;
	const commands = view.commands ?? [];
	const [, redraw] = useState(0);
	useEffect(() => client.on(() => redraw((count) => count + 1)), [client]);
	const [draft, write] = useState("");
	const [cursor, setCursor] = useState(0);
	const [sheet, setSheet] = useState<"settings" | "actions">();
	const field = useRef<HTMLTextAreaElement>(null);
	const send: Send = (type, data) => {
		client.send(type, data);
	};
	const take = (deliverAs: "steer" | "followUp"): void => {
		takeDraft(send, draft, () => write(""), deliverAs);
		field.current?.focus();
	};
	const empty = draft.trim() === "";
	const act = primaryAct(running, empty);
	const offering = suggestedAt(draft, cursor, commands, agents);
	const place = (next: { text: string; cursor: number }): void => {
		write(next.text);
		setCursor(next.cursor);
		requestAnimationFrame(() => field.current?.setSelectionRange(next.cursor, next.cursor));
		field.current?.focus();
	};
	const pick = (value: string): void => place(insertAt(draft, cursor, value));

	return (
		<div data-testid="composer" className="flex flex-col gap-2">
			<Waiting client={client} queue={waiting ?? []} />
			<div className="relative rounded-3xl border bg-raised transition-colors focus-within:border-ring/60">
				{offering.length === 0 ? null : <Offers offers={offering} onPick={pick} />}
				<Field
					ref={field}
					draft={draft}
					marks={marked(draft, commands, agents)}
					placeholder={running ? `Queue a message for ${name}` : `Write to ${name}`}
					onChange={(text, at) => {
						write(text);
						setCursor(at);
					}}
					onCursor={setCursor}
					onEnter={() => {
						if (offering[0] !== undefined) pick(offering[0].value);
						else if (!empty) take("followUp");
					}}
				/>
				<div className="flex items-center gap-1.5 px-2 pb-2">
					<Button
						variant="secondary"
						size="icon"
						aria-label="Commands and actions"
						className="size-9 shrink-0 rounded-full"
						onClick={() => setSheet("actions")}
					>
						<Icon icon={PlusSignIcon} />
					</Button>
					<Summary view={view} onPress={() => setSheet("settings")} />
					<div className="ms-auto flex items-center gap-1.5">
						{running && !empty ? (
							<Button
								variant="ghost"
								size="sm"
								aria-label="Send now"
								className="h-9 rounded-full px-3 text-[13px]"
								onClick={() => take("steer")}
							>
								<Icon icon={FlashIcon} className="size-3.5" />
								Now
							</Button>
						) : null}
						{act === "abort" ? (
							<Button
								variant="secondary"
								size="icon"
								aria-label="Abort"
								className="size-9 rounded-full"
								onClick={() => send("run.abort", {})}
							>
								<Icon icon={SquareIcon} strokeWidth={2.5} className="size-3.5" />
							</Button>
						) : (
							<Button
								size="icon"
								aria-label="Send"
								disabled={empty}
								className="size-9 rounded-full bg-pi text-white hover:bg-pi/90 disabled:bg-muted disabled:text-muted-foreground"
								onClick={() => take("followUp")}
							>
								<Icon icon={ArrowUp02Icon} strokeWidth={2.25} />
							</Button>
						)}
					</div>
				</div>
			</div>
			<SettingsSheet
				open={sheet === "settings"}
				onOpenChange={(open) => setSheet(open ? "settings" : undefined)}
				view={view}
				send={send}
			/>
			<ActionsSheet
				open={sheet === "actions"}
				onOpenChange={(open) => setSheet(open ? "actions" : undefined)}
				commands={commands}
				running={running}
				send={send}
				onCommand={(command) => place(withCommand(draft, command))}
				{...(ask === undefined
					? {}
					: {
							onRename: () => {
								const named = ask("Name this session")?.trim();
								if (named !== undefined && named !== "") send("session.rename", { name: named });
							},
						})}
			/>
		</div>
	);
}

/** The field, with the commands and the agents it knows painted over a transparent copy of its text. */
function Field({
	ref,
	draft,
	marks,
	placeholder,
	onChange,
	onCursor,
	onEnter,
}: {
	ref: React.Ref<HTMLTextAreaElement>;
	draft: string;
	marks: readonly { text: string; mark: boolean }[];
	placeholder: string;
	onChange: (text: string, cursor: number) => void;
	onCursor: (cursor: number) => void;
	onEnter: () => void;
}): ReactNode {
	const paint = useRef<HTMLDivElement>(null);
	const shape = "px-4 pt-3 pb-2 text-[15px] leading-relaxed whitespace-pre-wrap break-words";
	return (
		<div className="relative">
			<div
				ref={paint}
				aria-hidden="true"
				className={cn(
					"pointer-events-none absolute inset-0 overflow-hidden text-foreground",
					shape,
				)}
			>
				{marks.map((piece, at) =>
					piece.mark ? (
						<span key={at} className="rounded-[4px] bg-pi/15 text-pi">
							{piece.text}
						</span>
					) : (
						<span key={at}>{piece.text}</span>
					),
				)}
				{/* A newline at the end of the field needs a line to sit on. */}
				{draft.endsWith("\n") ? "\u200b" : null}
			</div>
			<textarea
				ref={ref}
				aria-label="Prompt"
				placeholder={placeholder}
				enterKeyHint="send"
				autoComplete="off"
				rows={1}
				value={draft}
				onChange={(event) => onChange(event.target.value, event.target.selectionStart)}
				onSelect={(event) => onCursor(event.currentTarget.selectionStart)}
				onScroll={(event) => {
					if (paint.current !== null) paint.current.scrollTop = event.currentTarget.scrollTop;
				}}
				onKeyDown={(event) => {
					if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
						event.preventDefault();
						onEnter();
					}
				}}
				className={cn(
					"relative block max-h-48 min-h-12 w-full resize-none bg-transparent text-transparent caret-foreground outline-none [field-sizing:content] placeholder:text-muted-foreground",
					shape,
				)}
			/>
		</div>
	);
}

function Offers({
	offers,
	onPick,
}: {
	offers: readonly Suggestion[];
	onPick: (value: string) => void;
}): ReactNode {
	return (
		<div
			role="listbox"
			aria-label="Suggestions"
			className="absolute inset-x-0 bottom-full mb-2 max-h-72 overflow-y-auto rounded-2xl border bg-popover p-1 shadow-lg"
		>
			{offers.map((one) => (
				<button
					type="button"
					role="option"
					aria-selected={false}
					key={one.value}
					aria-label={one.value}
					onMouseDown={(event) => event.preventDefault()}
					onClick={() => onPick(one.value)}
					className="flex w-full flex-col gap-0.5 rounded-xl px-3 py-2 text-left hover:bg-muted"
				>
					<span className="flex items-center gap-2 text-[14px] text-pi">
						<Icon icon={OFFER_ICON[one.group]} className="size-3.5" />
						{one.value}
					</span>
					{one.description === undefined ? null : (
						<span className="line-clamp-2 text-xs text-muted-foreground">{one.description}</span>
					)}
				</button>
			))}
		</div>
	);
}

const OFFER_ICON: Record<Suggestion["group"], IconSvgElement> = {
	skill: BookOpen02Icon,
	prompt: Note01Icon,
	pi: CommandLineIcon,
	agent: UserIcon,
};

/** The model, its thinking and the mode, in one line that opens the settings. */
function Summary({ view, onPress }: { view: ComposerView; onPress: () => void }): ReactNode {
	const model = modelLabel(view.model);
	const thinking = view.thinking ?? "";
	const mode = view.mode ?? "";
	const label = `Session settings: model ${model || "unknown"}, thinking ${thinking || "unknown"}, permission mode ${mode || "unknown"}`;
	return (
		<button
			type="button"
			aria-label={label}
			onClick={onPress}
			className="flex h-9 min-w-0 items-center gap-1.5 rounded-full bg-muted/60 px-3 text-[13px] text-muted-foreground transition-colors hover:bg-muted"
		>
			<span className="truncate text-foreground">{model === "" ? "Model" : model}</span>
			{thinking === "" || thinking === "off" ? null : <span className="shrink-0">{thinking}</span>}
			{mode === "" || mode === "manual" ? null : (
				<span className={cn("shrink-0", mode === "full" && "text-waits")}>{mode}</span>
			)}
		</button>
	);
}

type View = "root" | "mode" | "thinking" | "model";

const TITLES: Record<View, string> = {
	root: "Session",
	mode: "Permission mode",
	thinking: "Thinking",
	model: "Model",
};

/** How the session runs, with a view for each list. */
function SettingsSheet({
	open,
	onOpenChange,
	view,
	send,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	view: ComposerView;
	send: Send;
}): ReactNode {
	const [at, go] = useState<View>("root");
	const { mode, serves, model, models, modelsTotal, thinking } = view;
	const modes = modeChoices(mode, serves);
	const levels = levelChoices(thinking);
	const close = (): void => {
		onOpenChange(false);
		go("root");
	};
	return (
		<Panel
			open={open}
			onOpenChange={(next) => (next ? onOpenChange(true) : close())}
			title={TITLES[at]}
			{...(at === "mode" ? { description: MODE_NOTE } : {})}
			{...(at === "root" ? {} : { back: () => go("root") })}
		>
			{at === "root" ? (
				<Group>
					<Row
						label="Model"
						value={modelLabel(model)}
						{...(models === undefined || models.length === 0 ? {} : { onPress: () => go("model") })}
					/>
					<Row label="Thinking" value={thinking ?? ""} onPress={() => go("thinking")} />
					{serves === false ? null : (
						<Row label="Permission mode" value={mode ?? ""} onPress={() => go("mode")} />
					)}
				</Group>
			) : null}
			{at === "mode" ? (
				<Choices
					choices={modes}
					onPick={(value) => {
						close();
						send("mode.set", { mode: value as PermissionMode });
					}}
				/>
			) : null}
			{at === "thinking" ? (
				<Choices
					choices={levels}
					onPick={(value) => {
						close();
						send("thinking.set", { level: value });
					}}
				/>
			) : null}
			{at === "model" && models !== undefined ? (
				<Models
					models={models}
					total={modelsTotal}
					current={model}
					onPick={(picked) => {
						close();
						send("model.set", { provider: picked.provider, id: picked.id });
					}}
				/>
			) : null}
		</Panel>
	);
}

const MODE_NOTE = "Full, which runs every call without asking, is set in the terminal.";

/** What can be done to the session, and the commands it offers, which go into the field. */
function ActionsSheet({
	open,
	onOpenChange,
	commands,
	running,
	send,
	onCommand,
	onRename,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	commands: readonly SessionCommand[];
	running: boolean;
	send: Send;
	onCommand: (name: string) => void;
	onRename?: () => void;
}): ReactNode {
	const [query, setQuery] = useState("");
	const shown = matchCommands(commands, query);
	const close = (): void => {
		onOpenChange(false);
		setQuery("");
	};
	return (
		<Panel
			open={open}
			onOpenChange={(next) => (next ? onOpenChange(true) : close())}
			title="Commands"
		>
			<div className="flex flex-col gap-3">
				<Group>
					<Action label="Compact" onPress={() => (close(), send("session.compact", {}))} />
					{onRename === undefined ? null : (
						<Action label="Rename" onPress={() => (close(), onRename())} />
					)}
					{running ? (
						<Action label="Abort the run" onPress={() => (close(), send("run.abort", {}))} />
					) : null}
					<Action
						label="Stop the session"
						destructive
						onPress={() => (close(), send("session.stop", {}))}
					/>
				</Group>
				{commands.length === 0 ? (
					<p className="px-1 text-sm text-muted-foreground">
						This session has not said which commands it takes.
					</p>
				) : (
					<>
						<Search label="Search commands" value={query} onChange={setQuery} />
						{shown.length === 0 ? (
							<p className="py-6 text-center text-sm text-muted-foreground">No command matches</p>
						) : (
							<div className="flex flex-col gap-0.5">
								{shown.map((one) => (
									<button
										type="button"
										key={one.name}
										aria-label={`/${one.name}`}
										onClick={() => (close(), onCommand(one.name))}
										className="flex min-h-12 items-start gap-3 rounded-xl px-3 py-2 text-left hover:bg-muted"
									>
										<Icon icon={OFFER_ICON[one.source]} className="mt-0.5 size-4 text-dim" />
										<span className="flex min-w-0 flex-1 flex-col gap-0.5">
											<span className="truncate font-mono text-[13px]">/{one.name}</span>
											{one.description === undefined ? null : (
												<span className="line-clamp-2 text-xs text-muted-foreground">
													{one.description}
												</span>
											)}
										</span>
									</button>
								))}
							</div>
						)}
					</>
				)}
			</div>
		</Panel>
	);
}

function Search({
	label,
	value,
	onChange,
}: {
	label: string;
	value: string;
	onChange: (value: string) => void;
}): ReactNode {
	return (
		<label className="sticky top-0 z-10 flex h-10 items-center gap-2 rounded-xl border bg-popover px-3">
			<Icon icon={Search01Icon} className="text-dim" />
			<input
				type="text"
				enterKeyHint="search"
				aria-label={label}
				placeholder={label}
				value={value}
				onChange={(event) => onChange(event.target.value)}
				className="min-w-0 flex-1 bg-transparent text-sm outline-none"
			/>
			{value === "" ? null : (
				<button type="button" aria-label="Clear the search" onClick={() => onChange("")}>
					<Icon icon={Cancel01Icon} className="size-3.5 text-dim" />
				</button>
			)}
		</label>
	);
}

function Group({ children }: { children: ReactNode }): ReactNode {
	return <div className="flex flex-col overflow-hidden rounded-2xl bg-muted/60">{children}</div>;
}

/** "Permission mode: edits" to a screen reader; a row with nothing to choose is not a button. */
function Row({
	label,
	value,
	onPress,
}: {
	label: string;
	value: string;
	onPress?: () => void;
}): ReactNode {
	return (
		<button
			type="button"
			aria-label={`${label}: ${value === "" ? "not said yet" : value}`}
			disabled={onPress === undefined}
			onClick={onPress}
			className="flex min-h-13 items-center gap-3 px-4 py-3 text-left transition-colors not-last:border-b not-last:border-background/60 hover:bg-muted disabled:opacity-70"
		>
			<span className="flex-1 text-[15px]">{label}</span>
			<span
				className={cn(
					"truncate text-[14px] text-muted-foreground",
					value === "full" && "text-waits",
				)}
			>
				{value === "" ? "…" : value}
			</span>
			{onPress === undefined ? null : <Icon icon={ArrowRight01Icon} className="text-dim" />}
		</button>
	);
}

function Action({
	label,
	onPress,
	destructive = false,
}: {
	label: string;
	onPress: () => void;
	destructive?: boolean;
}): ReactNode {
	return (
		<button
			type="button"
			onClick={onPress}
			className={cn(
				"flex min-h-13 items-center px-4 py-3 text-left text-[15px] transition-colors not-last:border-b not-last:border-background/60 hover:bg-muted",
				destructive && "text-destructive",
			)}
		>
			{label}
		</button>
	);
}

/** What the session holds for later and what this device has not had answered, each with a way out. */
function Waiting({ client, queue }: { client: Client; queue: ComposerView["waiting"] }): ReactNode {
	const outbox = client.outbox().all();
	const held = new Set(
		client
			.outbox()
			.held()
			.map((command) => command.id),
	);
	const lines = queuedLines(queue ?? []);
	if (lines.length === 0 && outbox.length === 0) return null;
	return (
		<div
			className="flex flex-col gap-1 rounded-xl border border-dashed px-2 py-1.5"
			data-testid="lists"
		>
			{lines.map((line) => {
				const steering = queue?.find((one) => one.id === line.id)?.want === "steer";
				return (
					<div
						key={line.id}
						id={line.id}
						data-testid="held-row"
						className="flex items-center gap-2 py-0.5"
					>
						<Icon
							icon={steering ? ArrowTurnBackwardIcon : Clock01Icon}
							className={cn("size-3.5", steering ? "text-pi" : "text-dim")}
						/>
						<span className="shrink-0 text-xs font-medium text-muted-foreground">
							{steering ? "Steer" : "Queued"}
						</span>
						<span data-testid="held-text" className="min-w-0 flex-1 truncate text-sm">
							{line.text}
						</span>
						<span className="hidden shrink-0 text-xs text-dim sm:inline">{line.by}</span>
						<Button variant="ghost" size="sm" onClick={() => withdraw(client, line.id)}>
							Withdraw
						</Button>
					</div>
				);
			})}
			{outbox.map((command) => (
				<OutboxRow key={command.id} command={command} held={held} client={client} />
			))}
		</div>
	);
}

function OutboxRow({
	command,
	held,
	client,
}: {
	command: Outgoing;
	held: ReadonlySet<string>;
	client: Client;
}): ReactNode {
	const line = outboxLine(command, held);
	return (
		<div data-testid="outbox-row" className="flex items-center gap-2 py-0.5">
			<Icon icon={Clock01Icon} className="size-3.5 text-dim" />
			<span className="min-w-0 flex-1 truncate text-sm">
				<span className="font-mono text-xs text-muted-foreground">{command.type}</span> {line.text}
			</span>
			{line.actionable ? (
				<>
					<Button variant="ghost" size="sm" onClick={() => sendNow(client, command.id)}>
						Send now
					</Button>
					<Button variant="ghost" size="sm" onClick={() => dropNow(client, command.id)}>
						Drop
					</Button>
				</>
			) : null}
		</div>
	);
}

function Choices({
	choices,
	onPick,
}: {
	choices: readonly { value: string; hint?: string; chosen: boolean }[];
	onPick: (value: string) => void;
}): ReactNode {
	const id = useId();
	return (
		<div role="radiogroup" className="flex flex-col gap-1">
			{choices.map((one) => (
				<button
					type="button"
					role="radio"
					aria-checked={one.chosen}
					aria-label={one.value}
					{...(one.hint === undefined ? {} : { "aria-describedby": `${id}-${one.value}` })}
					key={one.value}
					onClick={() => onPick(one.value)}
					className={cn(
						"flex min-h-12 items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-muted",
						one.chosen && "bg-muted",
					)}
				>
					<span className="flex min-w-0 flex-1 flex-col">
						<span className={cn("font-mono text-sm", one.chosen && "font-semibold")}>
							{one.value}
						</span>
						{one.hint === undefined ? null : (
							<span id={`${id}-${one.value}`} className="text-xs text-muted-foreground">
								{one.hint}
							</span>
						)}
					</span>
					{one.chosen ? (
						<span data-testid="option-bar" className="text-pi">
							<Icon icon={Tick02Icon} strokeWidth={2.25} />
						</span>
					) : null}
				</button>
			))}
		</div>
	);
}

/** A registry is long, so the list has a search. */
function Models({
	models,
	total,
	current,
	onPick,
}: {
	models: readonly ModelOption[];
	total: number | undefined;
	current: { provider: string; id: string } | undefined;
	onPick: (model: ModelOption) => void;
}): ReactNode {
	const [query, setQuery] = useState("");
	const shown = matchModels(models, query);
	const note = modelsNote(models.length, total);
	return (
		<div className="flex flex-col gap-2">
			<Search label="Search models" value={query} onChange={setQuery} />
			{note === undefined ? null : <p className="text-xs text-muted-foreground">{note}</p>}
			{shown.length === 0 ? (
				<p className="py-6 text-center text-sm text-muted-foreground">No model matches</p>
			) : (
				<div role="radiogroup" className="flex flex-col gap-0.5">
					{shown.map((one) => {
						const chosenNow = isCurrentModel(one, current);
						return (
							<button
								type="button"
								role="radio"
								aria-checked={chosenNow}
								aria-label={one.name}
								key={`${one.provider}/${one.id}`}
								onClick={() => onPick(one)}
								className={cn(
									"flex min-h-12 items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-muted",
									chosenNow && "bg-muted",
								)}
							>
								<span className="flex min-w-0 flex-1 flex-col">
									<span className={cn("truncate text-sm", chosenNow && "font-semibold")}>
										{one.name}
									</span>
									<span className="truncate font-mono text-[11.5px] text-muted-foreground">
										{one.provider}/{one.id}
									</span>
								</span>
								{chosenNow ? (
									<span data-testid="option-bar" className="text-pi">
										<Icon icon={Tick02Icon} strokeWidth={2.25} />
									</span>
								) : null}
							</button>
						);
					})}
				</div>
			)}
		</div>
	);
}
