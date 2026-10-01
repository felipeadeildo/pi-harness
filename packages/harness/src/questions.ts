import { questions } from "@adeildo/pi-ask-questions";
import { createApp } from "@adeildo/pi-kit";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function harnessQuestions(pi: ExtensionAPI): void {
	createApp(pi, { name: "pi-harness" }).use(questions).build();
}
