// What the page does to a session of a machine's remote tmux: open it in a terminal window of that
// machine, let go of the windows that show it, end it, or move its pi out of tmux into a window.
import {
	actOnTerminal,
	listTerminals,
	type TerminalAction,
	type TerminalInfo,
} from "@adeildo/pi-remote-protocol/client";
import {
	AppWindowIcon,
	ArrowMoveUpRightIcon,
	ComputerTerminal01Icon,
	StopCircleIcon,
	Unlink01Icon,
} from "@hugeicons/core-free-icons";
import { type ReactNode, useCallback, useState } from "react";
import { useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { whyOf } from "@/session/why.ts";

import { Icon } from "./kit.tsx";
import { useRead } from "./read.tsx";

export interface Desk {
	act(terminal: TerminalInfo, action: TerminalAction): void;
	/** The action running now. */
	busy: TerminalAction | undefined;
	/** What the last action did, or why it failed. */
	said: { text: string; failed: boolean } | undefined;
}

/** `after` runs once an action is done, so the screen reads the terminals again. */
export function useDesk(machine: string, after: () => void): Desk {
	const [busy, setBusy] = useState<TerminalAction>();
	const [said, setSaid] = useState<Desk["said"]>();
	const act = (terminal: TerminalInfo, action: TerminalAction): void => {
		// Ending a session loses what runs there, so the page asks first.
		if (action === "stop" && !confirm(`End ${terminal.name} and what runs in it?`)) return;
		setBusy(action);
		setSaid(undefined);
		actOnTerminal(location.origin, machine, terminal.name, action).then(
			() => {
				setBusy(undefined);
				setSaid({ text: doneText(action, terminal.name, machine), failed: false });
				after();
			},
			(error: unknown) => {
				setBusy(undefined);
				setSaid({ text: whyOf(error, terminal.name), failed: true });
			},
		);
	};
	return { act, busy, said };
}

/** The menu's items for one terminal; `move` only where a pi the remote knows runs. */
export function DeskItems({
	terminal,
	machine,
	desk,
}: {
	terminal: TerminalInfo;
	machine: string;
	desk: Desk;
}): ReactNode {
	const windows = terminal.windows ?? 0;
	const item = (action: TerminalAction, icon: typeof AppWindowIcon, label: string) => (
		<DropdownMenuItem
			className="gap-2.5 py-2"
			disabled={desk.busy !== undefined}
			variant={action === "stop" ? "destructive" : "default"}
			onClick={() => desk.act(terminal, action)}
		>
			<Icon icon={icon} className="size-4" />
			{label}
		</DropdownMenuItem>
	);
	return (
		<>
			{item("window", AppWindowIcon, `Open in a window on ${machine}`)}
			{terminal.session === undefined
				? null
				: item("move", ArrowMoveUpRightIcon, `Move pi to a window, out of tmux`)}
			{windows === 0
				? null
				: item(
						"detach",
						Unlink01Icon,
						windows === 1 ? "Close its window" : `Close its ${windows} windows`,
					)}
			<DropdownMenuSeparator />
			{item("stop", StopCircleIcon, "End the session")}
		</>
	);
}

export function DeskNote({ desk }: { desk: Desk }): ReactNode {
	const said = desk.said;
	return (
		<p
			aria-live="polite"
			className={
				said?.failed === true ? "text-[13px] text-destructive" : "text-[13px] text-muted-foreground"
			}
		>
			{desk.busy === undefined ? said?.text : busyText(desk.busy)}
		</p>
	);
}

function busyText(action: TerminalAction): string {
	switch (action) {
		case "window":
			return "Opening a window…";
		case "move":
			return "Ending pi in tmux and opening it in a window…";
		case "detach":
			return "Closing its windows…";
		case "stop":
			return "Ending the session…";
	}
}

function doneText(action: TerminalAction, name: string, machine: string): string {
	switch (action) {
		case "window":
			return `${name} is open in a window on ${machine}.`;
		case "move":
			return `pi left tmux and goes on in a window on ${machine}, with the same conversation.`;
		case "detach":
			return `${name} runs on, with no window showing it.`;
		case "stop":
			return `${name} ended.`;
	}
}

/**
 * The tmux session a pi session runs in, when the page started it, and the desk's hand on it.
 * Undefined while terminals are off on its machine.
 */
export function useSessionDesk(
	machine: string,
	session: string,
): { terminal: TerminalInfo | undefined; desk: Desk } {
	const read = useCallback(
		() =>
			listTerminals(location.origin, machine).then((list) =>
				list.terminals.find((one) => one.session === session),
			),
		[machine, session],
	);
	const [found, again] = useRead(read, "the terminals");
	return { terminal: found?.value, desk: useDesk(machine, again) };
}

/** The session screen's terminal button: a shell in its folder, and the desk's actions on its tmux. */
export function TerminalMenu({
	machine,
	cwd,
	terminal,
	desk,
}: {
	machine: string;
	cwd: string | undefined;
	terminal: TerminalInfo | undefined;
	desk: Desk;
}): ReactNode {
	const navigate = useNavigate();
	if (cwd === undefined && terminal === undefined) return null;
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={<Button variant="ghost" size="icon" className="size-10" />}
				aria-label="Terminal"
			>
				<Icon icon={ComputerTerminal01Icon} className="size-[18px]" />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-auto">
				{cwd === undefined ? null : (
					<DropdownMenuItem
						className="gap-2.5 py-2"
						onClick={() =>
							void navigate(`/terminals?${new URLSearchParams({ machine, folder: cwd })}`)
						}
					>
						<Icon icon={ComputerTerminal01Icon} className="size-4" />
						Shell in this folder
					</DropdownMenuItem>
				)}
				{terminal === undefined ? null : (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuGroup>
							<DropdownMenuLabel translate="no">
								{terminal.name}, in the remote's tmux
							</DropdownMenuLabel>
							<DeskItems terminal={terminal} machine={machine} desk={desk} />
						</DropdownMenuGroup>
					</>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
