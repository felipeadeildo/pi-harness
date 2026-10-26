// The app's one theme: color, space, type and radius, named by what they are for rather than by the
// value they hold. A screen picks a step, never a number, so the screens agree with each other and a
// change of scale is one file.
//
// Two palettes, light and dark, under the same names, and nothing here reads a raw hex outside them. The
// surfaces and labels are the values iOS and Android give their own system colors, so a screen sits
// beside the system's. They are fixed values and not `PlatformColor`, because the web build and the DOM
// component read them too and a device is what a `PlatformColor` is proven on.
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
	/** The system face, for the document, which a web view draws with a serif unless told. */
	font: string;
	/** The smallest side of anything a thumb presses, in points. */
	hit: number;
}

/** The smallest side of anything a thumb presses, in points: no control undercuts it, in either scheme. */
export const HIT = 44;

export type Scheme = "light" | "dark";

const PALETTE: Record<Scheme, Theme["color"]> = {
	light: {
		background: "#ffffff",
		surface: "#f2f2f7",
		elevated: "#ffffff",
		border: "#c6c6c8",
		text: "#000000",
		muted: "#6c6c70",
		faint: "#8e8e93",
		accent: "#7459b4",
		ok: "#248a3d",
		warn: "#b25000",
		danger: "#d70015",
	},
	dark: {
		background: "#000000",
		surface: "#1c1c1e",
		elevated: "#2c2c2e",
		border: "#38383a",
		text: "#ffffff",
		muted: "#a1a1a6",
		faint: "#8e8e93",
		accent: "#a798d7",
		ok: "#30d158",
		warn: "#ff9f0a",
		danger: "#ff453a",
	},
};

/** The theme for a scheme: the system's, which a screen asks for with `useTheme`. */
export function themeFor(scheme: Scheme): Theme {
	return {
		color: PALETTE[scheme],
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
		font: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
		hit: HIT,
	};
}
