// A framed screen for a provider login: what it is doing, the URL or the code to use, and the answer
// it waits for. The provider drives it through the interaction pi would hand it.
import type { AuthEvent, AuthPrompt, ProviderAuthInteraction } from "@earendil-works/pi-ai";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	type Focusable,
	hyperlink,
	Input,
	Key,
	matchesKey,
	type TUI,
	truncateToWidth,
} from "@earendil-works/pi-tui";

import { frameBottom, frameInner, frameRow, frameTop } from "./frame.ts";

const MAX_LOG = 5;

export interface LoginSession {
	interaction: ProviderAuthInteraction;
	/** Ends the screen once the login finished one way or another. */
	close(): void;
}

/** Opens the framed login, or undefined when this host cannot draw it. */
export function loginScreen(
	ctx: ExtensionContext,
	label: string,
	signal: AbortSignal,
): Promise<LoginSession | undefined> {
	if (ctx.mode !== "tui" || typeof ctx.ui.custom !== "function") return Promise.resolve(undefined);
	return new Promise((resolve) => {
		void ctx.ui.custom<undefined>((tui, theme, _keybindings, done) => {
			const view = new LoginView(tui, theme, label, signal, () => done(undefined));
			resolve({ interaction: view.interaction(), close: () => view.finish() });
			return view;
		});
	});
}

interface Pending {
	prompt: AuthPrompt;
	resolve: (value: string) => void;
	reject: (error: Error) => void;
}

export class LoginView implements Component, Focusable {
	focused = true;
	private readonly input = new Input();
	private readonly log: string[] = [];
	private link: { text: string; url: string } | undefined;
	private code: string | undefined;
	private pending: Pending | undefined;
	private selected = 0;
	private closed = false;

	constructor(
		private readonly tui: TUI,
		private readonly theme: Theme,
		private readonly label: string,
		private readonly signal: AbortSignal,
		private readonly closeView: () => void,
	) {
		this.input.onSubmit = (value) => this.settle(value);
		this.input.onEscape = () => this.cancel();
		signal.addEventListener("abort", () => this.finish(), { once: true });
	}

	interaction(): ProviderAuthInteraction {
		return {
			signal: this.signal,
			prompt: async (prompt) => await this.ask(prompt),
			notify: (event) => this.show(event),
		};
	}

	invalidate(): void {}

	handleInput(data: string): void {
		const pending = this.pending;
		if (pending === undefined) return;
		if (pending.prompt.type === "select") {
			this.move(data, pending.prompt.options.length);
			return;
		}
		this.input.handleInput(data);
		this.tui.requestRender();
	}

	render(width: number): string[] {
		const inner = frameInner(width);
		const rows = this.log.slice(-MAX_LOG).map((line) => this.theme.fg("muted", `· ${line}`));
		if (this.link !== undefined) {
			rows.push(hyperlink(this.theme.fg("accent", this.link.text), this.link.url));
		}
		if (this.code !== undefined) rows.push(this.theme.bold(this.code));
		rows.push("", ...this.promptRows(inner), "", this.hint());
		return [
			frameTop(this.theme, `Entrar · ${this.label}`, width),
			...rows.map((row) => frameRow(this.theme, row, inner)),
			frameBottom(this.theme, width),
		];
	}

	/** Ends the screen; the login it was drawing ended one way or another. */
	finish(): void {
		if (this.closed) return;
		this.closed = true;
		this.cancel();
		this.closeView();
	}

	private ask(prompt: AuthPrompt): Promise<string> {
		return new Promise((resolve, reject) => {
			this.pending = { prompt, resolve, reject };
			this.selected = 0;
			this.input.setValue("");
			this.tui.requestRender();
		});
	}

	private show(event: AuthEvent): void {
		if (event.type === "auth_url") {
			this.link = { text: event.instructions ?? "open this page", url: event.url };
		} else if (event.type === "device_code") {
			this.code = event.userCode;
			this.link = { text: "open the device page", url: event.verificationUri };
		} else {
			this.log.push(event.message);
		}
		this.tui.requestRender();
	}

	private settle(value: string): void {
		const pending = this.pending;
		this.pending = undefined;
		this.tui.requestRender();
		pending?.resolve(value);
	}

	private cancel(): void {
		const pending = this.pending;
		this.pending = undefined;
		this.tui.requestRender();
		pending?.reject(new Error(`${this.label}: login cancelled`));
	}

	private move(data: string, count: number): void {
		if (count === 0) return;
		if (matchesKey(data, Key.up)) this.selected = (this.selected - 1 + count) % count;
		else if (matchesKey(data, Key.down)) this.selected = (this.selected + 1) % count;
		else if (matchesKey(data, Key.enter)) {
			const pending = this.pending;
			const option =
				pending?.prompt.type === "select" ? pending.prompt.options[this.selected] : undefined;
			if (option !== undefined) this.settle(option.id);
			return;
		} else if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
			this.cancel();
			return;
		}
		this.tui.requestRender();
	}

	private promptRows(inner: number): string[] {
		const pending = this.pending;
		if (pending === undefined) return [this.theme.fg("dim", "waiting…")];
		const room = Math.max(1, inner - 2);
		const asked = this.theme.fg("text", truncateToWidth(pending.prompt.message, inner));
		if (pending.prompt.type === "select") {
			const options = pending.prompt.options.map((option, index) => {
				const pointer = index === this.selected ? this.theme.fg("accent", "❯ ") : "  ";
				const label = index === this.selected ? this.theme.bold(option.label) : option.label;
				return `${pointer}${truncateToWidth(label, room)}`;
			});
			return [asked, ...options];
		}

		const value = this.input.getValue();
		const shown =
			pending.prompt.type === "secret" && value !== "" ? "•".repeat(value.length) : value;
		const field =
			shown === ""
				? this.theme.fg("dim", truncateToWidth(pending.prompt.placeholder ?? "", room))
				: `${shown}${this.theme.fg("accent", "▎")}`;
		return [asked, `${this.theme.fg("accent", "❯ ")}${field}`];
	}

	private hint(): string {
		const keys: [string, string][] =
			this.pending?.prompt.type === "select"
				? [
						["↑↓", "move"],
						["enter", "choose"],
						["esc", "cancel"],
					]
				: [
						["enter", "submit"],
						["esc", "cancel"],
					];
		return keys
			.map(([key, action]) => `${this.theme.fg("muted", key)} ${this.theme.fg("dim", action)}`)
			.join("   ");
	}
}
