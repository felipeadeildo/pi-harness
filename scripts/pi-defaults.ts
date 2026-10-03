#!/usr/bin/env bun
import { SettingsManager } from "@earendil-works/pi-coding-agent";

import { PI_SETTINGS } from "../packages/harness/src/setup.ts";

const defaults = SettingsManager.inMemory();
const problems: string[] = [];

for (const setting of PI_SETTINGS) {
	const now = setting.read(defaults);
	if (now === setting.value) {
		problems.push(`${setting.key}: pi's default is ${now} now, the harness's value. Drop it.`);
	} else if (now !== setting.piDefault) {
		problems.push(
			`${setting.key}: pi's default moved from ${setting.piDefault} to ${now}. The harness sets ${setting.value} because ${setting.why}. Decide again, and record the new default.`,
		);
	}
}

if (problems.length > 0) {
	console.error(
		`The pi settings in packages/harness/src/setup.ts are out of date:\n  ${problems.join("\n  ")}`,
	);
	process.exit(1);
}
console.log(
	`pi's defaults are still the ones the ${PI_SETTINGS.length} harness settings were chosen against.`,
);
