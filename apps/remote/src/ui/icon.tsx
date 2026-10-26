// The icons a control may draw: SF Symbols on iOS and Material Symbols everywhere else, one family per
// platform. Every icon names both, so a symbol that exists only on Apple cannot be added: an icon with no
// Material name would draw nothing on Android.
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { SymbolView } from "expo-symbols";
import type { ReactNode } from "react";

import { ICONS, type IconName } from "./icon-names.ts";

/** One icon at one size in one color, from the family the platform draws with. */
export function Icon({
	name,
	size,
	color,
}: {
	name: IconName;
	size: number;
	color: string;
}): ReactNode {
	if (process.env.EXPO_OS === "ios")
		return (
			<SymbolView
				name={ICONS[name].sf}
				tintColor={color}
				resizeMode="scaleAspectFit"
				style={{ width: size, height: size }}
			/>
		);
	return <MaterialIcons name={ICONS[name].md} size={size} color={color} />;
}
