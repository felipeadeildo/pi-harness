// The package's version, which the bridge, the daemon and the command all report. The build inlines
// the JSON, so the built files carry the version they were built from.
import manifest from "../package.json" with { type: "json" };

export const VERSION: string = manifest.version;
