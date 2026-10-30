// Runs in its own process, since pi-web-access reads its config path once from the environment.
// Its sources load by name, so tsc does not check them with this repository's rules.
import { stdout } from "node:process";

function load<T>(file: string): Promise<T> {
	return import(`pi-web-access/${file}`) as Promise<T>;
}

const { answerFromPage } = await load<{
	answerFromPage(input: object, ctx: unknown): Promise<unknown>;
}>("page-query.ts");
const { extractContent } = await load<{
	extractContent(
		url: string,
		signal: undefined,
		options: object,
	): Promise<{ error: string | null }>;
}>("extract.ts");
const { getConfiguredSearchRouting } = await load<{ getConfiguredSearchRouting(): unknown }>(
	"gemini-search.ts",
);
const { getWebSearchConfigPath } = await load<{ getWebSearchConfigPath(): string }>("utils.ts");

const asked: string[] = [];
const ctx = {
	modelRegistry: {
		getAvailable: () => [],
		find: (provider: string, id: string) => void asked.push(`${provider}/${id}`),
	},
};

const server = Bun.serve({
	port: 0,
	hostname: "127.0.0.1",
	fetch: () =>
		new Response("<html><body><p>A page.</p></body></html>", {
			headers: { "content-type": "text/html" },
		}),
});
const fetched = await extractContent(`http://127.0.0.1:${server.port}/`, undefined, {});
await server.stop(true);
const answer = await answerFromPage({ question: "q", pageText: "p", sourceUrl: "u" }, ctx).catch(
	(error: unknown) => String(error),
);

stdout.write(
	`${JSON.stringify({
		path: getWebSearchConfigPath(),
		searchRouting: getConfiguredSearchRouting() ?? null,
		fetchError: fetched.error,
		answerAsked: asked,
		answer,
	})}\n`,
);
