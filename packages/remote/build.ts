// Builds the daemon and the command into one JavaScript file each. Node runs them outside pi, where
// nothing compiles TypeScript, so every dependency goes inside and only Node's own modules stay out.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const ENTRIES = {
	"daemon.js": join(import.meta.dir, "src/daemon/main.ts"),
	"cli.js": join(import.meta.dir, "src/cli/main.ts"),
};

/** What `ws` loads when it is there, and works without. */
const OPTIONAL = ["bufferutil", "utf-8-validate"];

export interface Built {
	/** Each file written, by its name in `outdir`. */
	files: Record<keyof typeof ENTRIES, string>;
	/** What the files import from outside themselves. Only Node's own modules belong here. */
	outside: string[];
}

export async function buildRemote(outdir: string): Promise<Built> {
	const outside = new Set<string>();
	const files: Partial<Record<keyof typeof ENTRIES, string>> = {};
	for (const [name, entry] of Object.entries(ENTRIES) as [keyof typeof ENTRIES, string][]) {
		// oxlint-disable-next-line no-await-in-loop -- two builds, and their errors read better apart
		const result = await Bun.build({
			entrypoints: [entry],
			target: "node",
			format: "esm",
			outdir,
			naming: name,
			metafile: true,
			// `ws` asks for these two in a `try`, to use them when an install happens to have them: they
			// stay out of the bundle and the build passes without them.
			external: OPTIONAL,
		});
		if (!result.success) throw new AggregateError(result.logs, `could not build ${name}`);
		for (const input of Object.values(result.metafile?.inputs ?? {})) {
			for (const imported of input.imports)
				if (imported.external === true) outside.add(imported.path);
		}
		files[name] = join(outdir, name);
	}
	return { files: files as Built["files"], outside: [...outside].toSorted() };
}

/**
 * Node's own modules, as the Node that runs the built files lists them. Bun counts a few packages,
 * `ws` among them, as its own modules, so its list would let them through.
 */
export function nodeBuiltins(node = Bun.which("node") ?? "node"): Set<string> {
	const script = "JSON.stringify(require('node:module').builtinModules)";
	const result = spawnSync(node, ["-p", script], { encoding: "utf8" });
	if (result.error !== undefined || result.status !== 0) {
		const why = result.error?.message ?? result.stderr.trim();
		throw new Error(
			`the build checks its files against Node's own modules, and ${node} did not answer: ${why}`,
		);
	}
	return new Set(JSON.parse(result.stdout) as string[]);
}

/** The imports a built file must not have: anything but Node's own modules. */
export function foreign(outside: readonly string[], builtins: ReadonlySet<string>): string[] {
	return outside.filter(
		(path) =>
			!builtins.has(path.startsWith("node:") ? path.slice(5) : path) && !OPTIONAL.includes(path),
	);
}

/** Builds the page with Vite into `web` next to the daemon, where the daemon looks for it. */
function buildWeb(outdir: string): void {
	const web = join(outdir, "web");
	const result = spawnSync("bun", ["x", "vite", "build", "--outDir", web, "--emptyOutDir"], {
		cwd: join(import.meta.dir, "web"),
		stdio: "inherit",
	});
	if (result.status !== 0) throw new Error("the page's build failed");
	if (!existsSync(join(web, "index.html"))) throw new Error(`the build left no ${web}/index.html`);
}

if (import.meta.main) {
	const built = await buildRemote(join(import.meta.dir, "dist"));
	const wrong = foreign(built.outside, nodeBuiltins());
	if (wrong.length > 0) {
		console.error(`the built files import more than Node's own modules: ${wrong.join(", ")}`);
		process.exit(1);
	}
	for (const file of Object.values(built.files)) console.log(file);
	buildWeb(join(import.meta.dir, "dist"));
}
