// The colors of pi's own theme that a session can wear, by the name pi gives them, in the two schemes.
// The bridge sends a name (`accent`, `syntaxKeyword`), never a value, so the app owns the values and
// the dark and the light both have one. A name this table does not hold has no color here, and the
// screen draws the label in its own text color: a color nobody chose is not invented.
//
// The values are the ones pi's `dark` and `light` themes resolve to; `pi-colors.test.ts` reads those
// files and fails when they move, so this table cannot diverge from the terminal in silence.
import type { Scheme } from "./theme.ts";

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

/** The color pi's theme gives a name in a scheme, or nothing when the name is not one the app holds. */
export function piColor(scheme: Scheme, name: string | undefined): string | undefined {
	return name === undefined ? undefined : PI_COLORS[scheme][name];
}

/** The names the table holds, which is what the conformity test reads back from pi's themes. */
export const PI_COLOR_NAMES = Object.keys(PI_COLORS.dark);
