// The root of the remote app: one stack, with no header, so the exported build is one page until the
// sessions screen lands.
import { Stack } from "expo-router";

export default function Root() {
	return <Stack screenOptions={{ headerShown: false }} />;
}
