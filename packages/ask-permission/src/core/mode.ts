export const PERMISSION_MODES = ["manual", "edits", "judge", "full"] as const;

export type PermissionMode = (typeof PERMISSION_MODES)[number];

export const DEFAULT_MODE: PermissionMode = "manual";

export interface ModeRules {
	description: string;
	edits: boolean;
	judge: boolean;
	everything: boolean;
	/** A bash command with paths it cannot read, like `$VAR`, counts as outside. */
	unknownIsOutside: boolean;
}

export const MODES: Record<PermissionMode, ModeRules> = {
	manual: {
		description: "reads run, everything else asks",
		edits: false,
		judge: false,
		everything: false,
		unknownIsOutside: true,
	},
	edits: {
		description: "reads and file edits run, everything else asks",
		edits: true,
		judge: false,
		everything: false,
		unknownIsOutside: true,
	},
	judge: {
		description: "reads and file edits run, the judge decides the rest",
		edits: true,
		judge: true,
		everything: false,
		unknownIsOutside: false,
	},
	full: {
		description: "every call runs",
		edits: true,
		judge: false,
		everything: true,
		unknownIsOutside: false,
	},
};

// 4.x names, still in settings files and saved sessions.
const ALIASES: Record<string, PermissionMode> = {
	"accept-edits": "edits",
	"accept edits": "edits",
	accept: "edits",
	auto: "full",
	yolo: "full",
};

export function parseMode(text: string): PermissionMode | undefined {
	const value = text.trim().toLowerCase();
	return PERMISSION_MODES.find((mode) => mode === value) ?? ALIASES[value];
}

export function nextMode(mode: PermissionMode): PermissionMode {
	const index = PERMISSION_MODES.indexOf(mode);
	return PERMISSION_MODES[(index + 1) % PERMISSION_MODES.length] ?? DEFAULT_MODE;
}
