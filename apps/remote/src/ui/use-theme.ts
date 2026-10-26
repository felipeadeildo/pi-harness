// The theme the system's scheme picks, for a component to draw with.
import { useColorScheme } from "react-native";

import { type Theme, themeFor } from "./theme.ts";

export function useTheme(): Theme {
	return themeFor(useColorScheme() === "dark" ? "dark" : "light");
}
