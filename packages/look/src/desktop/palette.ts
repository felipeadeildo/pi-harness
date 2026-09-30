import type { ThemeColor } from "@earendil-works/pi-coding-agent";

export const DESKTOP_THEME = "desktop";

export type Mode = "dark" | "light";

export interface DesktopColors {
	mode: Mode;
	roles: Readonly<Record<string, string>>;
	terminal: Readonly<Record<string, string>>;
}

export interface ThemeJson {
	$schema: string;
	name: string;
	vars: Record<string, string>;
	colors: Record<string, string>;
	export: { pageBg: string; cardBg: string; infoBg: string };
}

const HEX = /^#[0-9a-f]{6}$/i;

export function parseDesktopColors(json: unknown, mode?: Mode): DesktopColors | undefined {
	if (!isRecord(json) || !isRecord(json.colors) || !isRecord(json.dank16)) return undefined;
	const chosen: Mode = mode ?? (json.mode === "light" ? "light" : "dark");
	const roles = json.colors[chosen];
	if (!isRecord(roles)) return undefined;

	const terminal: Record<string, string> = {};
	for (const [name, value] of Object.entries(json.dank16)) {
		const hex = isRecord(value) ? (value[chosen] ?? value.default) : value;
		if (typeof hex === "string" && HEX.test(hex)) terminal[name] = hex;
	}

	const material: Record<string, string> = {};
	for (const [name, value] of Object.entries(roles)) {
		if (typeof value === "string" && HEX.test(value)) material[name] = value;
	}
	return { mode: chosen, roles: material, terminal };
}

const REQUIRED_ROLES = [
	"primary",
	"secondary",
	"tertiary",
	"error",
	"error_container",
	"outline",
	"outline_variant",
	"on_surface",
	"on_surface_variant",
	"surface",
	"surface_container_low",
	"surface_container",
	"surface_container_high",
	"surface_container_highest",
];
const REQUIRED_TERMINAL = ["color1", "color2", "color3", "color6", "color9"];

export function missingColors(colors: DesktopColors): string[] {
	return [
		...REQUIRED_ROLES.filter((role) => colors.roles[role] === undefined),
		...REQUIRED_TERMINAL.filter((name) => colors.terminal[name] === undefined),
	];
}

export function desktopTheme(colors: DesktopColors): ThemeJson {
	const role = (name: string): string => colors.roles[name] ?? "#808080";
	const term = (name: string): string => colors.terminal[name] ?? "#808080";

	const vars: Record<string, string> = {
		primary: role("primary"),
		secondary: role("secondary"),
		tertiary: role("tertiary"),
		error: role("error"),
		outline: role("outline"),
		outlineVariant: role("outline_variant"),
		text: role("on_surface"),
		subtext: role("on_surface_variant"),
		surface: role("surface"),
		containerLow: role("surface_container_low"),
		container: role("surface_container"),
		containerHigh: role("surface_container_high"),
		containerHighest: role("surface_container_highest"),
		red: term("color1"),
		green: term("color2"),
		yellow: term("color3"),
		cyan: term("color6"),
		brightRed: term("color9"),
		successBg: mix(role("surface_container_low"), term("color2"), 0.12),
		errorBg: mix(role("surface_container_low"), role("error"), 0.14),
		infoBg: mix(role("surface_container"), term("color3"), 0.1),
	};

	const colorsByToken: Record<ThemeColor | BackgroundToken, string> = {
		accent: "primary",
		border: "outline",
		borderAccent: "primary",
		borderMuted: "outlineVariant",
		success: "green",
		error: "error",
		warning: "yellow",
		muted: "subtext",
		dim: "outline",
		text: "text",
		thinkingText: "subtext",

		selectedBg: "containerHigh",
		scrollbarTrack: "outlineVariant",
		scrollbarThumb: "subtext",
		searchMatchBg: "containerHighest",
		searchMatchText: "text",
		userMessageBg: "container",
		userMessageText: "text",
		customMessageBg: "containerLow",
		customMessageText: "text",
		customMessageLabel: "tertiary",
		toolPendingBg: "containerLow",
		toolSuccessBg: "successBg",
		toolErrorBg: "errorBg",
		toolTitle: "text",
		toolOutput: "subtext",

		mdHeading: "tertiary",
		mdLink: "primary",
		mdLinkUrl: "outline",
		mdCode: "secondary",
		mdCodeBlock: "text",
		mdCodeBlockBorder: "outlineVariant",
		mdQuote: "subtext",
		mdQuoteBorder: "outlineVariant",
		mdHr: "outlineVariant",
		mdListBullet: "primary",

		toolDiffAdded: "green",
		toolDiffRemoved: "red",
		toolDiffContext: "subtext",

		syntaxComment: "outline",
		syntaxKeyword: "primary",
		syntaxFunction: "tertiary",
		syntaxVariable: "text",
		syntaxString: "green",
		syntaxNumber: "yellow",
		syntaxType: "cyan",
		syntaxOperator: "subtext",
		syntaxPunctuation: "subtext",

		thinkingOff: "outlineVariant",
		thinkingMinimal: "outline",
		thinkingLow: "secondary",
		thinkingMedium: "primary",
		thinkingHigh: "tertiary",
		thinkingXhigh: "brightRed",
		thinkingMax: "red",

		bashMode: "green",
	};

	return {
		$schema:
			"https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/src/modes/interactive/theme/theme-schema.json",
		name: DESKTOP_THEME,
		vars,
		colors: colorsByToken,
		export: { pageBg: vars.surface ?? "", cardBg: vars.container ?? "", infoBg: vars.infoBg ?? "" },
	};
}

type BackgroundToken =
	| "selectedBg"
	| "searchMatchBg"
	| "userMessageBg"
	| "customMessageBg"
	| "toolPendingBg"
	| "toolSuccessBg"
	| "toolErrorBg";

export function mix(base: string, tint: string, amount: number): string {
	const a = channels(base);
	const b = channels(tint);
	const mixed = a.map((value, index) => Math.round(value + ((b[index] ?? value) - value) * amount));
	return `#${mixed.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function channels(hex: string): number[] {
	const value = HEX.test(hex) ? hex.slice(1) : "808080";
	return [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
