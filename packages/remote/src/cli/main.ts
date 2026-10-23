// The entry the build turns into dist/cli.js. Node runs it directly, so it runs on import.
import { run } from "./run.ts";

process.exitCode = run(process.argv.slice(2), console.log, console.error);
