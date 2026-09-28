// In the harness every feature runs inside one extension, so pi reports every failure under the
// same name. These put the app and the feature in front of it instead.

export function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

// A sync function stays sync, because pi treats some handler results differently when they are
// promises.
export function attributed<A extends unknown[], R>(
	label: string,
	run: (...args: A) => R,
): (...args: A) => R {
	return (...args: A): R => {
		let result: R;
		try {
			result = run(...args);
		} catch (error) {
			throw relabel(label, error);
		}
		if (!(result instanceof Promise)) return result;
		// Still the same kind of promise, only rejected with the relabeled error.
		return result.catch((error: unknown) => {
			throw relabel(label, error);
		}) as R;
	};
}

function relabel(label: string, error: unknown): Error {
	return new Error(`${label}: ${describe(error)}`, { cause: error });
}
