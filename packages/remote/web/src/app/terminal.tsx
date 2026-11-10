// A terminal of a machine's remote tmux, full screen: the shell's screen live, a key bar for a
// phone's keyboard under it, and a reconnect when the connection drops. The shell goes on when the
// page closes.
import "@xterm/xterm/css/xterm.css";
import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { cn } from "cn";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";

import { buttonVariants } from "@/components/ui/button";
import { browserSource } from "@/session/browser.ts";
import {
	type BarKey,
	type Closed,
	closedOf,
	keyBytes,
	retryAfter,
	terminalSocketUrl,
	withCtrl,
} from "@/session/terminal-data.ts";

import { Icon } from "./kit.tsx";

type Status = { kind: "connecting" | "open" | "lost" } | Exclude<Closed, { kind: "lost" }>;

/** The page's own colors, as plain values xterm reads. */
const THEMES = {
	dark: {
		background: "#000000",
		foreground: "#ececec",
		cursor: "#ececec",
		selectionBackground: "#ffffff40",
	},
	light: {
		background: "#ffffff",
		foreground: "#111111",
		cursor: "#111111",
		selectionBackground: "#00000030",
	},
};

export function Component(): ReactNode {
	const { machine = "", name = "" } = useParams();
	const host = useRef<HTMLDivElement>(null);
	const terminal = useRef<Terminal | undefined>(undefined);
	const send = useRef<(data: string) => void>(() => {});
	const ctrl = useRef(false);
	const [ctrlOn, setCtrlOn] = useState(false);
	const [status, setStatus] = useState<Status>({ kind: "connecting" });

	useEffect(() => {
		const box = host.current;
		if (box === null) return;
		const dark = matchMedia("(prefers-color-scheme: dark)").matches;
		const term = new Terminal({
			fontFamily: getComputedStyle(document.documentElement).getPropertyValue("--font-mono"),
			fontSize: 13,
			cursorBlink: !matchMedia("(prefers-reduced-motion: reduce)").matches,
			scrollback: 5000,
			theme: dark ? THEMES.dark : THEMES.light,
		});
		const fit = new FitAddon();
		term.loadAddon(fit);
		term.open(box);
		fit.fit();
		terminal.current = term;

		let ws: WebSocket | undefined;
		let attempt = 0;
		let stopped = false;
		let retry: ReturnType<typeof setTimeout> | undefined;
		const connect = (): void => {
			void browserSource().then((ready) => {
				if (stopped) return;
				if (ready.why !== undefined)
					return setStatus({ kind: "refused", status: 401, text: ready.why });
				const socket = new WebSocket(
					terminalSocketUrl(location, machine, name, { cols: term.cols, rows: term.rows }),
				);
				socket.binaryType = "arraybuffer";
				socket.onopen = () => {
					attempt = 0;
					setStatus({ kind: "open" });
				};
				socket.onmessage = (event) => term.write(new Uint8Array(event.data as ArrayBuffer));
				socket.onclose = (event) => {
					if (stopped) return;
					const closed = closedOf(event.code, event.reason);
					if (closed.kind !== "lost") return setStatus(closed);
					setStatus({ kind: "lost" });
					retry = setTimeout(connect, retryAfter(attempt++));
				};
				ws = socket;
			});
		};
		const message = (value: unknown): void => {
			if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(value));
		};
		send.current = (data) => message({ type: "input", data });
		const typed = term.onData((data) => {
			if (!ctrl.current) return send.current(data);
			ctrl.current = false;
			setCtrlOn(false);
			send.current(withCtrl(data));
		});
		const sized = term.onResize(({ cols, rows }) => message({ type: "resize", cols, rows }));
		// The phone's keyboard opening shrinks the page, and the terminal with it.
		const observer = new ResizeObserver(() => fit.fit());
		observer.observe(box);
		connect();
		term.focus();
		return () => {
			stopped = true;
			clearTimeout(retry);
			observer.disconnect();
			typed.dispose();
			sized.dispose();
			ws?.close();
			term.dispose();
			terminal.current = undefined;
		};
	}, [machine, name]);

	const press = (key: BarKey): void =>
		send.current(keyBytes(key, terminal.current?.modes.applicationCursorKeysMode === true));
	const toggleCtrl = (): void => {
		ctrl.current = !ctrl.current;
		setCtrlOn(ctrl.current);
		terminal.current?.focus();
	};

	return (
		<main className="flex h-full min-w-0 flex-1 flex-col bg-background">
			<header className="flex shrink-0 items-center gap-1.5 border-b px-2 pt-[max(0.5rem,env(safe-area-inset-top))] pb-1.5 sm:px-4">
				<Link
					to={`/terminals?machine=${encodeURIComponent(machine)}`}
					aria-label="All terminals"
					className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "size-10")}
				>
					<Icon icon={ArrowLeft01Icon} className="size-5" />
				</Link>
				<div className="flex min-w-0 flex-1 flex-col">
					<h1 className="truncate font-mono text-[14px] font-semibold" translate="no">
						{name}
					</h1>
					<p className="truncate text-[12px] text-muted-foreground" aria-live="polite">
						{statusText(status, machine)}
					</p>
				</div>
			</header>
			<div ref={host} className="min-h-0 flex-1 overflow-hidden px-1.5 pt-1" />
			{status.kind === "ended" || status.kind === "refused" ? (
				<div className="flex shrink-0 items-center gap-3 border-t px-4 py-3">
					<p
						className={cn(
							"min-w-0 flex-1 text-[13.5px]",
							status.kind === "refused" && "text-destructive",
						)}
					>
						{status.text}
					</p>
					<Link
						to={`/terminals?machine=${encodeURIComponent(machine)}`}
						className={buttonVariants({ variant: "outline", size: "sm" })}
					>
						All terminals
					</Link>
				</div>
			) : (
				<KeyBar
					press={press}
					ctrlOn={ctrlOn}
					toggleCtrl={toggleCtrl}
					type={(text) => send.current(text)}
				/>
			)}
		</main>
	);
}

function statusText(status: Status, machine: string): string {
	switch (status.kind) {
		case "connecting":
			return `Connecting to ${machine}…`;
		case "open":
			return `Connected to ${machine}`;
		case "lost":
			return `Reconnecting to ${machine}…`;
		case "ended":
			return `Ended on ${machine}`;
		case "refused":
			return `Not open on ${machine}`;
	}
}

/** What a phone's keyboard lacks. A press keeps the focus in the terminal, so the keyboard stays up. */
function KeyBar({
	press,
	ctrlOn,
	toggleCtrl,
	type,
}: {
	press: (key: BarKey) => void;
	ctrlOn: boolean;
	toggleCtrl: () => void;
	type: (text: string) => void;
}): ReactNode {
	const keep = (event: { preventDefault(): void }) => event.preventDefault();
	// The keys share the width, so a phone shows them all without scrolling.
	const key =
		"h-10 min-w-0 flex-1 rounded-md font-mono text-[13px] text-muted-foreground outline-none hover:bg-accent/60 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 active:bg-accent";
	const keys: [string, string, () => void][] = [
		["Esc", "Escape", () => press("esc")],
		["Tab", "Tab", () => press("tab")],
		["↑", "Up", () => press("up")],
		["↓", "Down", () => press("down")],
		["←", "Left", () => press("left")],
		["→", "Right", () => press("right")],
		...["|", "~", "/", "-"].map((text): [string, string, () => void] => [
			text,
			text,
			() => type(text),
		]),
	];
	return (
		<div
			role="toolbar"
			aria-label="Keys"
			className="flex shrink-0 gap-0.5 border-t px-1 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] [@media(pointer:fine)]:hidden"
		>
			<button
				type="button"
				aria-pressed={ctrlOn}
				onPointerDown={keep}
				onClick={toggleCtrl}
				className={cn(key, ctrlOn && "bg-accent text-foreground")}
			>
				Ctrl
			</button>
			{keys.map(([label, spoken, act]) => (
				<button
					key={label}
					type="button"
					aria-label={spoken}
					onPointerDown={keep}
					onClick={act}
					className={key}
				>
					{label}
				</button>
			))}
		</div>
	);
}
