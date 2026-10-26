// The root of the remote app: one stack, with no header. The login a link carries happens here, once,
// because the link points at the root and every route after it needs the cookie.
import { Stack } from "expo-router";

import { useLoginOnce } from "../session/login-once.ts";
import { useTheme } from "../ui/use-theme.ts";

export default function Root() {
	useLoginOnce();
	const theme = useTheme();
	return (
		<Stack
			screenOptions={{
				headerShown: false,
				contentStyle: { backgroundColor: theme.color.background },
			}}
		/>
	);
}
