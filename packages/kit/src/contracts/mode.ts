// The permission mode, which the permission feature owns and anything else can read.
import { defineContract } from "../contract.ts";
import { type Problem, isObject, literal, pass } from "../decode.ts";
import type { By } from "./by.ts";

export const PERMISSION_MODES = ["manual", "edits", "judge", "full"] as const;

export type PermissionMode = (typeof PERMISSION_MODES)[number];

export const MODE = defineContract<PermissionMode>("mode", literal(...PERMISSION_MODES));

/** What a feature that wants the mode changed asks the owner to do. */
export interface ModeSet {
	/** Applied as if typed at the terminal, and announced through `MODE`. */
	set(mode: PermissionMode, by?: By): void;
}

/** Whether the value is a way to set the mode, said in a type the compiler can carry forward. */
function isModeSet(value: unknown): value is ModeSet {
	return isObject(value) && typeof value.set === "function";
}

export const MODE_SET = defineContract<ModeSet>("mode:set", {
	decode(value) {
		return isModeSet(value)
			? pass(value)
			: { ok: false, problems: [{ path: "", message: "a way to set the mode" }] as Problem[] };
	},
});
