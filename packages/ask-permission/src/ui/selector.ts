import { openAboveEditor } from "@adeildo/pi-kit";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { type Scope, SCOPE_LABEL, SCOPES } from "#core/always-yes.ts";
import type { DialogAnswer, FolderOffer } from "#core/answer.ts";
import type { CallDescriptor } from "#core/tools.ts";
import { fallbackChoices } from "#ui/decision-options.ts";

export async function askViaSelector(
	ctx: ExtensionContext,
	toolName: string,
	target: CallDescriptor,
	offer?: FolderOffer,
): Promise<DialogAnswer> {
	const choices = fallbackChoices(offer);
	const labels = choices.map((option) => `${option.key}. ${option.label}`);
	const asked = `Allow ${toolName}?`;
	const choice =
		// A host that can draw a component keeps the editor visible under the question, and one that
		// cannot still has the plain selector. Both answer the same list.
		drawsAboveEditor(ctx)
			? await overEditor(ctx, asked, target.summary, labels)
			: await ctx.ui.select(`${asked}\n${target.summary}`, labels);
	const option = choice ? choices[labels.indexOf(choice)] : undefined;
	if (!option) return { decision: "deny" };

	const folder = offer?.folders[offer.suggested];
	const open =
		option.open && offer && folder !== undefined
			? { path: folder, access: offer.access, scope: "session" as const }
			: undefined;

	let remember: string | undefined;
	let scope: Scope | undefined;
	if (option.always) {
		if (target.levels.length === 1) {
			remember = target.levels[0];
		} else {
			const level = await ctx.ui.select("Always yes for...", target.levels);
			if (!level) return { decision: "deny" };
			remember = level;
		}

		const scopeLabels = SCOPES.map((candidate) => SCOPE_LABEL[candidate]);
		const picked = await ctx.ui.select("Remember for...", scopeLabels);
		if (!picked) return { decision: "deny" };
		scope = SCOPES[scopeLabels.indexOf(picked)];
	}

	let note: string | undefined;
	if (option.note) {
		const prompt = option.decision === "allow" ? "Note to the agent:" : "Reason for the agent:";
		note = (await ctx.ui.input(prompt))?.trim() || undefined;
	}

	return { decision: option.decision, note, remember, scope, open };
}

/** The keys the dialog reads, in the ones the terminal sends for them. */
const ONE = "1".charCodeAt(0);
const NINE = "9".charCodeAt(0);
const ESCAPE = "\u001b";

/** Whether this host can draw the question above the editor, keeping the editor under it. */
function drawsAboveEditor(ctx: ExtensionContext): boolean {
	const ui = ctx.ui as Partial<{ custom: unknown; getEditorText: unknown }>;
	return typeof ui.custom === "function" && typeof ui.getEditorText === "function";
}

/**
 * The permission asked above the editor, where the reader is already typing: a dialog that took the
 * editor's place would hide the command the question is about.
 */
async function overEditor(
	ctx: ExtensionContext,
	title: string,
	summary: string,
	labels: readonly string[],
): Promise<string | undefined> {
	const picked = await openAboveEditor<number>(ctx.ui, (slot) => ({
		render: () => [title, summary, ...labels, `esc denies`],
		handleInput: (data) => {
			if (data === ESCAPE) {
				slot.finish(-1);
				return;
			}
			const code = data.charCodeAt(0);
			// A key it does not read is dropped: the answer is one of the numbers, and nothing else.
			if (data.length !== 1 || code < ONE || code > NINE) return;
			const at = code - ONE;
			if (at < labels.length) slot.finish(at);
		},
		finish: slot.finish,
	}));
	return picked === undefined || picked < 0 ? undefined : labels[picked];
}
