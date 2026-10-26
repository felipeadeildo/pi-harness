import { defineContract } from "../contract.ts";
import { guarded, isObject } from "../decode.ts";

export interface NamesValue {
	handle: string;
}

export const NAMES = defineContract<NamesValue>("names", guarded(isNames, "a name"));

function isNames(value: unknown): value is NamesValue {
	return isObject(value) && typeof value.handle === "string" && value.handle.length > 0;
}
