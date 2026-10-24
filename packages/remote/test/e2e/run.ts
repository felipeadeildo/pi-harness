// A real pi session with the remote extension, scripted so it answers without a network call.
import { createRig } from "@adeildo/pi-kit/rig";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";

import piRemote from "../../src/index.ts";

const rig = await createRig({
	extensions: [piRemote],
	answer: () => fauxAssistantMessage("Answered from the session."),
});
process.env.PI_REMOTE_SHARE = "1";
console.log("rig up");
setTimeout(() => {
	rig.dispose();
	process.exit(0);
}, 60_000);
