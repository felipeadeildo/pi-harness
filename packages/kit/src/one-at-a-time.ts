// Pi shows one dialog at a time and never settles one that another replaces (earendil-works/pi#7007).

export type Turns = <T>(task: () => Promise<T>, signal?: AbortSignal) => Promise<T>;

/** Runs tasks one at a time, in order. A task aborted while it waits never runs. */
export function oneAtATime(): Turns {
	let last: Promise<unknown> = Promise.resolve();

	return <T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> => {
		const before = last;
		const mine = waitFor(before, signal).then(task);
		last = mine.then(
			() => undefined,
			() => before,
		);
		return mine;
	};
}

function waitFor(before: Promise<unknown>, signal: AbortSignal | undefined): Promise<void> {
	if (signal === undefined) return before.then(() => undefined);
	if (signal.aborted) return Promise.reject(signal.reason);

	return new Promise((resolve, reject) => {
		const leave = () => reject(signal.reason);
		signal.addEventListener("abort", leave, { once: true });
		void before.then(() => {
			signal.removeEventListener("abort", leave);
			resolve();
		});
	});
}
