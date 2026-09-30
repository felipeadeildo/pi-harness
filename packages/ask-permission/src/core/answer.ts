import type { Scope } from "#core/always-yes.ts";
import type { Access } from "#core/folders.ts";
import type { FolderChoices } from "#core/workspace.ts";

/** A call that left the workspace, with the folders the dialog can open for it. */
export interface FolderOffer extends FolderChoices {
	access: Access;
}

export interface DialogAnswer {
	decision: "allow" | "deny";
	note?: string;
	remember?: string;
	scope?: Scope;
	open?: { path: string; access: Access; scope: Scope };
}
