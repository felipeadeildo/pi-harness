// The permission mode, which the permission feature owns and anything else can read.
import { defineContract } from "../contract.ts";
import { type Problem, isObject, literal, pass } from "../decode.ts";
import type { By } from "./by.ts";

export const PERMISSION_MODES = ["manual", "edits", "judge", "full"] as const;

export type PermissionMode = (typeof PERMISSION_MODES)[number];

export const MODE = defineContract<PermissionMode>("mode", literal(...PERMISSION_MODES));

/** What a feature that wants the mode changed asks the owner to do. */
export interface ModeSet {
	/**
	 * Applies the mode, as the terminal would. The owner records it, shows it and announces it through
	 * `MODE`, so every reader learns of it the same way as of a change at the keyboard.
	 */
	set(mode: PermissionMode, by?: By): void;
}

/**
 * The way in to the mode. The owner provides it, and a feature that has no session of its own, such
 * as the remote's bridge, asks through it instead of writing the owner's state.
 */
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
