// The renderers the harness's features register, kept so a view can draw another session's entries
// the way pi draws this one's. Pi resolves its own chain but gives extensions no way to call it.
import type {
	MessageRenderer,
	ToolRendererResolver,
	ToolRenderers,
} from "@earendil-works/pi-coding-agent";

interface Registered {
	tools: ToolRendererResolver[];
	messages: Map<string, MessageRenderer>;
}

// By feature, in the order they mount, which is the order pi resolves them in. A feature mounted again
// for the next session replaces what it registered for the last one.
const byFeature = new Map<string, Registered>();

/** Forgets what `feature` registered, before it mounts again. */
export function forgetRenderers(feature: string): void {
	byFeature.delete(feature);
}

export function keepToolRenderer(feature: string, resolver: ToolRendererResolver): void {
	registered(feature).tools.push(resolver);
}

export function keepMessageRenderer(
	feature: string,
	customType: string,
	renderer: MessageRenderer,
): void {
	registered(feature).messages.set(customType, renderer);
}

/** The renderers for `toolName` after every feature's resolver, over `base`, as pi resolves them. */
export function resolveToolRenderers(
	toolName: string,
	base: () => ToolRenderers | undefined,
): ToolRenderers | undefined {
	const resolvers = [...byFeature.values()].flatMap((one) => one.tools);
	function resolve(index: number): ToolRenderers | undefined {
		const resolver = resolvers[index];
		return resolver === undefined ? base() : resolver(toolName, () => resolve(index + 1));
	}
	return resolve(0);
}

/** The renderer a feature registered for a custom message type, the first one as in pi. */
export function messageRendererFor(customType: string): MessageRenderer | undefined {
	for (const one of byFeature.values()) {
		const renderer = one.messages.get(customType);
		if (renderer !== undefined) return renderer;
	}
	return undefined;
}

function registered(feature: string): Registered {
	let one = byFeature.get(feature);
	if (one === undefined) {
		one = { tools: [], messages: new Map() };
		byFeature.set(feature, one);
	}
	return one;
}
