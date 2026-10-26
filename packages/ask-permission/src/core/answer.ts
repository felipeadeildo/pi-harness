import type { By } from "@adeildo/pi-kit";

import type { Scope } from "#core/always-yes.ts";
import type { Access } from "#core/folders.ts";
import type { FolderChoices } from "#core/workspace.ts";

export interface FolderOffer extends FolderChoices {
	access: Access;
}

export interface DialogAnswer {
	decision: "allow" | "deny";
	note?: string;
	remember?: string;
	scope?: Scope;
	open?: { path: string; access: Access; scope: Scope };
	/** Who answered, when the question went through a provider that says so. */
	by?: By;
}
