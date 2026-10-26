// The build inlines the JSON, so built files carry the version they were built from.
import manifest from "../package.json" with { type: "json" };

export const VERSION: string = manifest.version;
