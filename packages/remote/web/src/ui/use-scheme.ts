import { useSyncExternalStore } from "react";

import type { Scheme } from "./pi-colors.ts";

const DARK = "(prefers-color-scheme: dark)";

function subscribe(changed: () => void): () => void {
	const query = matchMedia(DARK);
	query.addEventListener("change", changed);
	return () => query.removeEventListener("change", changed);
}

/** The system's scheme, which the CSS follows by itself and the colors a session names need in JS. */
export function useScheme(): Scheme {
	return useSyncExternalStore(
		subscribe,
		() => (matchMedia(DARK).matches ? "dark" : "light"),
		() => "light",
	);
}
