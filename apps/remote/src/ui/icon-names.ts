// The names of the icons a control may draw, in the two families a platform draws with. Data only,
// with no native import, so a test reads it without a device.
import type MaterialIcons from "@expo/vector-icons/MaterialIcons";
import type { SFSymbol } from "expo-symbols";
import type { ComponentProps } from "react";

export const ICONS = {
	chevron: { sf: "chevron.down", md: "expand-more" },
	more: { sf: "ellipsis", md: "more-horiz" },
} as const satisfies Record<
	string,
	{ sf: SFSymbol; md: ComponentProps<typeof MaterialIcons>["name"] }
>;

export type IconName = keyof typeof ICONS;
