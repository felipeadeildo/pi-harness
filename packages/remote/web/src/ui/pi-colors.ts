// Pi's theme colors by name, for dark and light. A name not in the table gets no color.
// `pi-colors.test.ts` fails when pi's theme files change.
/** Followed with `prefers-color-scheme`. */
export type Scheme = "light" | "dark";

const PI_COLORS: Record<Scheme, Record<string, string>> = {
	dark: {
		accent: "#a798d7",
		syntaxKeyword: "#69add0",
		syntaxString: "#de8d5a",
		syntaxVariable: "#5db3ba",
		syntaxType: "#a798d7",
	},
	light: {
		accent: "#7459b4",
		syntaxKeyword: "#2f7899",
		syntaxString: "#a45417",
		syntaxVariable: "#287a81",
		syntaxType: "#7459b4",
	},
};

export function piColor(scheme: Scheme, name: string | undefined): string | undefined {
	return name === undefined ? undefined : PI_COLORS[scheme][name];
}

/** What the conformity test reads back from pi's themes. */
export const PI_COLOR_NAMES = Object.keys(PI_COLORS.dark);
