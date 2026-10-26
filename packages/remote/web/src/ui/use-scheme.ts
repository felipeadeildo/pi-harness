import { useSyncExternalStore } from "react";

import type { Scheme } from "./pi-colors.ts";

const DARK = "(prefers-color-scheme: dark)";

function subscribe(changed: () => void): () => void {
	const query = matchMedia(DARK);
	query.addEventListener("change", changed);
	return () => query.removeEventListener("change", changed);
}

/** CSS follows it by itself; session colors need it in JS. */
export function useScheme(): Scheme {
	return useSyncExternalStore(
		subscribe,
		() => (matchMedia(DARK).matches ? "dark" : "light"),
		() => "light",
	);
}
