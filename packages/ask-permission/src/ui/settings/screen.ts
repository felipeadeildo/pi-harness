import { type ExtensionContext, getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import { Container, type SettingItem, SettingsList, Text } from "@earendil-works/pi-tui";

import type { AlwaysYes } from "#core/always-yes.ts";
import {
	isNoteDelivery,
	isNoUIMode,
	isOutsideScope,
	type OutsideScope,
	type PermissionConfig,
} from "#core/config/schema.ts";
import { POLICY_TEMPLATE, policyWarning } from "#core/judge/policy.ts";
import { MODES, parseMode, PERMISSION_MODES, type PermissionMode } from "#core/mode.ts";
import { OUTSIDE_DESCRIPTION, OUTSIDE_SCOPES } from "#core/workspace.ts";
import { NAME } from "#identity";
import { buildJudgeSettings, type JudgeSettings, judgeValues } from "#ui/settings/judge.ts";

export interface SettingsState {
	config: PermissionConfig;
	alwaysYes: AlwaysYes;
	mode: () => PermissionMode;
	setMode: (mode: PermissionMode) => void;
	outside: () => OutsideScope;
	setOutside: (outside: OutsideScope) => void;
	save: () => void;
	onJudgeChange: () => void;
}

type SettingsRequest = { kind: "policy" } | { kind: "model" } | undefined;

export async function openSettings(ctx: ExtensionContext, state: SettingsState): Promise<void> {
	for (;;) {
		// oxlint-disable-next-line no-await-in-loop -- the menu loop is sequential by design.
		const request = await showSettings(ctx, state);
		if (!request) return;

		if (request.kind === "policy") {
			// oxlint-disable-next-line no-await-in-loop -- one editor at a time.
			await editPolicy(ctx, state);
			continue;
		}

		// oxlint-disable-next-line no-await-in-loop -- one prompt at a time.
		await editModel(ctx, state);
	}
}

async function editPolicy(ctx: ExtensionContext, state: SettingsState): Promise<void> {
	const judge = state.config.judge;
	const text = await ctx.ui.editor("Judge policy", judge.policy || POLICY_TEMPLATE);
	if (text === undefined) return;

	judge.policy = text;
	state.save();
	state.onJudgeChange();

	const warning = policyWarning(text);
	if (warning) ctx.ui.notify(`${NAME}: ${warning}`, "warning");
}

async function editModel(ctx: ExtensionContext, state: SettingsState): Promise<void> {
	const text = await ctx.ui.input("Jev model", "jev-latest");
	const model = text?.trim();
	if (!model) return;

	state.config.judge.model = model;
	state.save();
	state.onJudgeChange();
}

const SETTINGS_VISIBLE = 18;

async function showSettings(ctx: ExtensionContext, state: SettingsState): Promise<SettingsRequest> {
	let request: SettingsRequest;

	await ctx.ui.custom<void>((_tui, theme, _keybindings, done) => {
		const close = () => done(undefined);
		const container = new Container();
		let settings: SettingsList | undefined;
		let judgeSettings: JudgeSettings | undefined;

		const hooks = {
			config: state.config.judge,
			theme,
			piModels: piModelIds(ctx),
			save: () => {
				state.save();
				state.onJudgeChange();
			},
			editPolicy: () => {
				request = { kind: "policy" };
				close();
			},
			editModel: () => {
				request = { kind: "model" };
				close();
			},
		};

		const buildItems = (): SettingItem[] => {
			judgeSettings = buildJudgeSettings(hooks);
			const session = { mode: state.mode(), outside: state.outside() };
			const judged = session.mode === "judge" || state.config.mode === "judge";
			const children = judged
				? judgeSettings.items.map((item) => ({ ...item, label: `Judge \u00b7 ${item.label}` }))
				: [];

			return topLevelItems(state.config, session, children);
		};

		const install = (focusId: string): void => {
			if (settings) container.removeChild(settings);
			settings = new SettingsList(
				buildItems(),
				SETTINGS_VISIBLE,
				getSettingsListTheme(),
				onChange,
				close,
			);
			container.addChild(settings);
			settings.selectItem(focusId);
		};

		const refreshModelRow = (): void => {
			settings?.updateValue("judge.model", judgeValues(state.config.judge)["judge.model"]);
		};

		const onChange = (id: string, value: string): void => {
			if (id.startsWith("judge.")) {
				judgeSettings?.onChange(id, value);
				refreshModelRow();
				return;
			}

			switch (id) {
				case "session.mode": {
					const mode = parseMode(value);
					if (mode) state.setMode(mode);
					// The judge rows show only in judge mode.
					install(id);
					return;
				}
				case "session.outside":
					if (isOutsideScope(value)) state.setOutside(value);
					return;
				case "mode": {
					const mode = parseMode(value);
					if (mode) state.config.mode = mode;
					state.save();
					install(id);
					return;
				}
				case "workspace.outside":
					if (isOutsideScope(value)) state.config.workspace.outside = value;
					break;
				case "notes":
					if (isNoteDelivery(value)) state.config.notes = value;
					break;
				case "noUI":
					if (isNoUIMode(value)) state.config.noUI = value;
					break;
				case "readOnlyBash":
					state.config.readOnlyBash = value === "on";
					break;
			}
			state.save();
		};

		container.addChild(
			new Text(
				theme.fg("accent", theme.bold(NAME)) +
					theme.fg("dim", `  \u00b7  ${alwaysYesCount(state.alwaysYes.total())}`),
				1,
				1,
			),
		);
		install("session.mode");

		return {
			render: (width: number) => container.render(width),
			invalidate: () => container.invalidate(),
			handleInput: (data: string) => settings?.handleInput?.(data),
		};
	});

	return request;
}

export function topLevelItems(
	config: PermissionConfig,
	session: { mode: PermissionMode; outside: OutsideScope },
	judgeChildren: SettingItem[],
): SettingItem[] {
	return [
		modeItem("session.mode", "Mode (this session)", session.mode),
		outsideItem("session.outside", "Outside the workspace (this session)", session.outside),
		modeItem("mode", "Mode (new sessions)", config.mode),
		outsideItem(
			"workspace.outside",
			"Outside the workspace (new sessions)",
			config.workspace.outside,
		),
		readOnlyBashItem(config),
		notesItem(config),
		noUIItem(config),
		...judgeChildren,
	];
}

function modeItem(id: string, label: string, mode: PermissionMode): SettingItem {
	return {
		id,
		label,
		currentValue: mode,
		values: [...PERMISSION_MODES],
		description: MODES[mode].description,
	};
}

function outsideItem(id: string, label: string, outside: OutsideScope): SettingItem {
	return {
		id,
		label,
		currentValue: outside,
		values: [...OUTSIDE_SCOPES],
		description: OUTSIDE_DESCRIPTION[outside],
	};
}

function notesItem(config: PermissionConfig): SettingItem {
	return {
		id: "notes",
		label: "Notes",
		currentValue: config.notes,
		values: ["result", "message"],
		description: "result adds your note to the tool result. message sends it on its own.",
	};
}

function readOnlyBashItem(config: PermissionConfig): SettingItem {
	return {
		id: "readOnlyBash",
		label: "Read-only bash",
		currentValue: config.readOnlyBash ? "on" : "off",
		values: ["off", "on"],
		description: "Commands that only read run without asking. In full everything runs anyway.",
	};
}

function noUIItem(config: PermissionConfig): SettingItem {
	return {
		id: "noUI",
		label: "With no UI",
		currentValue: typeof config.noUI === "string" ? config.noUI : "per tool",
		values: ["deny", "allow"],
		description: "When nobody can answer, as in print mode or a subagent.",
	};
}

function piModelIds(ctx: ExtensionContext): string[] {
	return ctx.modelRegistry
		.getAvailable()
		.map((model) => `${model.provider}/${model.id}`)
		.toSorted((left, right) => left.localeCompare(right));
}

export function alwaysYesCount(count: number): string {
	return `${count} always yes`;
}
