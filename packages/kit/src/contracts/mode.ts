// The permission mode, which the permission feature owns and anything else can read.
import { defineContract } from "../contract.ts";
import { literal } from "../decode.ts";

export const PERMISSION_MODES = ["manual", "edits", "judge", "full"] as const;

export type PermissionMode = (typeof PERMISSION_MODES)[number];

export const MODE = defineContract<PermissionMode>("mode", literal(...PERMISSION_MODES));
