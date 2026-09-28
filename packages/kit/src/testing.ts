// Fakes for testing features without a running pi. Two fakes on one bus behave like two extensions
// in the same pi process.
import {
	createEventBus,
	type EventBus,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";

type Handler = (event: unknown, ctx: ExtensionContext) => unknown;

export interface FakePi {
	pi: ExtensionAPI;
	fire(name: string, event: unknown, ctx: ExtensionContext): Promise<unknown[]>;
	count(name: string): number;
}

export function fakePi(bus: EventBus = createEventBus()): FakePi {
	const handlers = new Map<string, Handler[]>();
	const pi = {
		on: (name: string, handler: Handler) => {
			handlers.set(name, [...(handlers.get(name) ?? []), handler]);
			return () => {};
		},
		events: bus,
	} as unknown as ExtensionAPI;

	return {
		pi,
		async fire(name, event, ctx) {
			const results: unknown[] = [];
			for (const handler of handlers.get(name) ?? []) {
				// oxlint-disable-next-line no-await-in-loop -- pi runs handlers one at a time, in order
				results.push(await handler(event, ctx));
			}
			return results;
		},
		count: (name) => handlers.get(name)?.length ?? 0,
	};
}

export function fakeContext(
	notes: string[] = [],
	hasUI = true,
	extra: Record<string, unknown> = {},
): ExtensionContext {
	return {
		hasUI,
		mode: hasUI ? "tui" : "print",
		cwd: "/nonexistent",
		isProjectTrusted: () => false,
		ui: { notify: (message: string) => notes.push(message) },
		...extra,
	} as unknown as ExtensionContext;
}
