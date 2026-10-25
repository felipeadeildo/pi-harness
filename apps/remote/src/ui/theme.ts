// The app's one theme: color, space, type and radius, named by what they are for rather than by the
// value they hold. A screen picks a step, never a number, so the screens agree with each other and a
// change of scale is one file.
//
// One palette for now. A second one is a map of the same names, and nothing here reads a raw hex.
// No React Native import: the values are data, and a test reads them without a device.
/** Steps of the spacing scale, in pixels: 0, 2, 4, 8, 12, 16, 24. */
export const SPACE = [0, 2, 4, 8, 12, 16, 24] as const;
/** Corner radii, in pixels: square, soft, card, sheet. */
export const RADIUS = [0, 6, 10, 16] as const;

type SpaceStep = 0 | 1 | 2 | 3 | 4 | 5 | 6;
type RadiusStep = 0 | 1 | 2 | 3;

export interface Theme {
	color: {
		background: string;
		surface: string;
		elevated: string;
		border: string;
		text: string;
		muted: string;
		faint: string;
		accent: string;
		ok: string;
		warn: string;
		danger: string;
	};
	space(step: SpaceStep): number;
	radius(step: RadiusStep): number;
	type: {
		title: { fontSize: number; fontWeight: "600" | "700" };
		heading: { fontSize: number; fontWeight: "600" };
		body: { fontSize: number; fontWeight: "400" };
		label: { fontSize: number; fontWeight: "500" };
		caption: { fontSize: number; fontWeight: "400" };
		mono: { fontSize: number; fontFamily: string };
	};
	line: { hairline: number; thick: number };
}

export const theme: Theme = {
	color: {
		background: "#ffffff",
		surface: "#f7f7f8",
		elevated: "#ffffff",
		border: "#dcdce0",
		text: "#141416",
		muted: "#5b5b63",
		faint: "#8e8e97",
		accent: "#2563eb",
		ok: "#15803d",
		warn: "#b45309",
		danger: "#b91c1c",
	},
	space: (step) => SPACE[step],
	radius: (step) => RADIUS[step],
	type: {
		title: { fontSize: 22, fontWeight: "700" },
		heading: { fontSize: 17, fontWeight: "600" },
		body: { fontSize: 15, fontWeight: "400" },
		label: { fontSize: 13, fontWeight: "500" },
		caption: { fontSize: 12, fontWeight: "400" },
		mono: { fontSize: 13, fontFamily: "monospace" },
	},
	// The thinnest line a screen may draw. A device rounds it to its own pixel grid.
	line: { hairline: 0.5, thick: 2 },
};
