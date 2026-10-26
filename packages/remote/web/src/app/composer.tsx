// Under the transcript: what waits to be delivered, then the field with its pickers and its button.
// What each control decides lives in `session/composer-data.ts`.
import type {
	CommandMap,
	CommandType,
	ModelOption,
	PermissionMode,
} from "@adeildo/pi-remote-protocol";
import type { Client, Outgoing } from "@adeildo/pi-remote-protocol/client";
import {
	AiBrain01Icon,
	ArrowTurnBackwardIcon,
	ArrowUp02Icon,
	Cancel01Icon,
	ChipIcon,
	Clock01Icon,
	MoreHorizontalIcon,
	Search01Icon,
	SecurityCheckIcon,
	SquareIcon,
	Tick02Icon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import { cn } from "cn";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InputGroup, InputGroupAddon, InputGroupTextarea } from "@/components/ui/input-group";
import {
	dropNow,
	isCurrentModel,
	levelChoices,
	matchModels,
	type MenuItem,
	menuItems,
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
import { chosen, suggested } from "@/session/suggestions.ts";

import { Icon, Panel } from "./kit.tsx";

type Send = <K extends CommandType>(type: K, data: CommandMap[K]) => void;

export function Composer({
	client,
	view,
	name,
	ask,
}: {
	client: Client;
	view: ComposerView;
	/** Whom the field writes to, in its placeholder. */
	name: string;
	ask?: (question: string) => string | undefined;
}): ReactNode {
	const { waiting, commands, running } = view;
	const [, redraw] = useState(0);
	useEffect(() => client.on(() => redraw((count) => count + 1)), [client]);
	const [draft, write] = useState("");
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
	const offering = suggested(draft, commands ?? []);
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
				const named = ask?.("Name this session")?.trim();
				if (named !== undefined && named !== "") send("session.rename", { name: named });
				return;
			}
			default: {
				const unhandled: never = id;
				return unhandled;
			}
		}
	};

	return (
		<div data-testid="composer" className="flex flex-col gap-2">
			<Waiting client={client} queue={waiting ?? []} />
			<InputGroup className="relative rounded-2xl bg-raised shadow-sm dark:bg-raised">
				{offering.length === 0 ? null : (
					<div className="absolute inset-x-0 bottom-full mb-2 max-h-64 overflow-y-auto rounded-xl border bg-popover p-1 shadow-lg">
						{offering.map((one) => (
							<button
								type="button"
								key={one.name}
								aria-label={one.name}
								onMouseDown={(event) => event.preventDefault()}
								onClick={() => write(chosen(one.name))}
								className="flex w-full items-baseline gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-muted"
							>
								<span className="font-mono text-[13px] text-foreground">{one.name}</span>
								{one.description === undefined ? null : (
									<span className="truncate text-xs text-muted-foreground">{one.description}</span>
								)}
							</button>
						))}
					</div>
				)}
				<InputGroupTextarea
					ref={field}
					aria-label="Prompt"
					placeholder={running ? `Queue a message for ${name}` : `Write to ${name}`}
					enterKeyHint="send"
					autoComplete="off"
					rows={1}
					value={draft}
					onChange={(event) => write(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
							event.preventDefault();
							if (!empty) take("followUp");
						}
					}}
					className="max-h-48 min-h-11 px-3.5 pt-3 text-[15px] leading-relaxed"
				/>
				<InputGroupAddon align="block-end" className="gap-1 px-2 pb-2">
					<Pickers send={send} view={view} />
					<div className="ms-auto flex items-center gap-1">
						<More
							items={menuItems({ running, empty, canRename: ask !== undefined })}
							onPick={runMenu}
						/>
						{act === "abort" ? (
							<Button
								variant="destructive"
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
								className="size-9 rounded-full"
								onClick={() => take("followUp")}
							>
								<Icon icon={ArrowUp02Icon} strokeWidth={2.25} />
							</Button>
						)}
					</div>
				</InputGroupAddon>
			</InputGroup>
		</div>
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

function More({
	items,
	onPick,
}: {
	items: readonly MenuItem[];
	onPick: (id: MenuItem["id"]) => void;
}): ReactNode {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button variant="ghost" size="icon" aria-label="More" className="size-9 rounded-full" />
				}
			>
				<Icon icon={MoreHorizontalIcon} />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" side="top" className="min-w-48">
				{items.map((item) => (
					<DropdownMenuItem
						key={item.id}
						disabled={!item.enabled}
						variant={item.id === "stop" || item.id === "abort" ? "destructive" : "default"}
						onClick={() => onPick(item.id)}
					>
						{item.label}
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

type Open = "mode" | "thinking" | "model" | undefined;

function Pickers({ send, view }: { send: Send; view: ComposerView }): ReactNode {
	const { mode, serves, model, models, modelsTotal, thinking } = view;
	const [open, setOpen] = useState<Open>(undefined);
	const modes = modeChoices(mode, serves);
	const levels = levelChoices(thinking);
	const current = (list: readonly { value: string; chosen: boolean }[]): string =>
		list.find((one) => one.chosen)?.value ?? "";
	const close = (): void => setOpen(undefined);
	return (
		<div className="flex min-w-0 items-center gap-0.5 overflow-x-auto no-scrollbar">
			{modes.length === 0 ? null : (
				<Chip
					icon={SecurityCheckIcon}
					title="Permission mode"
					value={current(modes)}
					onPress={() => setOpen("mode")}
				/>
			)}
			<Chip
				icon={AiBrain01Icon}
				title="Thinking"
				value={current(levels)}
				onPress={() => setOpen("thinking")}
			/>
			<Chip
				icon={ChipIcon}
				title="Model"
				value={modelLabel(model)}
				{...(models === undefined || models.length === 0
					? {}
					: { onPress: () => setOpen("model") })}
			/>
			<Panel
				open={open === "mode"}
				onOpenChange={(next) => (next ? setOpen("mode") : close())}
				title="Permission mode"
				description="Full, which runs every call without asking, is set in the terminal."
			>
				<Choices
					choices={modes}
					onPick={(value) => {
						close();
						send("mode.set", { mode: value as PermissionMode });
					}}
				/>
			</Panel>
			<Panel
				open={open === "thinking"}
				onOpenChange={(next) => (next ? setOpen("thinking") : close())}
				title="Thinking"
			>
				<Choices
					choices={levels}
					onPick={(value) => {
						close();
						send("thinking.set", { level: value });
					}}
				/>
			</Panel>
			{models === undefined ? null : (
				<Panel
					open={open === "model"}
					onOpenChange={(next) => (next ? setOpen("model") : close())}
					title="Model"
				>
					<Models
						models={models}
						total={modelsTotal}
						current={model}
						onPick={(picked) => {
							close();
							send("model.set", { provider: picked.provider, id: picked.id });
						}}
					/>
				</Panel>
			)}
		</div>
	);
}

/** A picker that shows what is chosen: "Permission mode: edits" to a screen reader. */
function Chip({
	icon,
	title,
	value,
	onPress,
}: {
	icon: IconSvgElement;
	title: string;
	value: string;
	onPress?: () => void;
}): ReactNode {
	return (
		<Button
			variant="ghost"
			size="sm"
			aria-label={`${title}: ${value === "" ? "not said yet" : value}`}
			disabled={onPress === undefined}
			onClick={onPress}
			className="h-8 shrink-0 gap-1.5 rounded-full px-2.5 font-mono text-[12px] text-muted-foreground disabled:opacity-60"
		>
			<Icon icon={icon} className="size-3.5" />
			<span className="max-w-[9rem] truncate">{value === "" ? "…" : value}</span>
		</Button>
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
			<label className="sticky top-0 z-10 flex h-10 items-center gap-2 rounded-xl border bg-popover px-3">
				<Icon icon={Search01Icon} className="text-dim" />
				<input
					type="text"
					enterKeyHint="search"
					aria-label="Search models"
					placeholder="Search models"
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					className="min-w-0 flex-1 bg-transparent text-sm outline-none"
				/>
				{query === "" ? null : (
					<button type="button" aria-label="Clear the search" onClick={() => setQuery("")}>
						<Icon icon={Cancel01Icon} className="size-3.5 text-dim" />
					</button>
				)}
			</label>
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
