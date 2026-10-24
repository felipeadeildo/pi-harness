// The entry the build turns into dist/daemon.js, one daemon per machine. C5 in
// docs/remote-plan.md fills it in; until then it only answers `--version`, so the build and the
// launcher have a real file to point at.
import { VERSION } from "../version.ts";

if (process.argv[2] === "--version") console.log(VERSION);
else {
	console.error("pi-remote daemon: not implemented yet");
	process.exitCode = 1;
}
