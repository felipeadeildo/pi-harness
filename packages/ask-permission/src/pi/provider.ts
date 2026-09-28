import type { FeatureScope } from "@adeildo/pi-kit";

import { TYPESAFE_BASE_URL, TYPESAFE_PROVIDER } from "#core/judge/backends/jev.ts";

export function registerTypesafeProvider(scope: FeatureScope): void {
	scope.registerProvider(TYPESAFE_PROVIDER, {
		name: "TypeSafe (Jev)",
		baseUrl: TYPESAFE_BASE_URL,
		apiKey: "$TYPESAFE_API_KEY",
	});
}
