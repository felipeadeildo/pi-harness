import { run } from "./run.ts";

process.exitCode = await run(process.argv.slice(2), console.log, console.error);
