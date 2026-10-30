<h1 align="center">@adeildo/pi-web</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/@adeildo/pi-web"><img src="https://img.shields.io/npm/v/@adeildo/pi-web" alt="npm"></a>
  <a href="https://github.com/nicobailon/pi-web-access"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Ffelipeadeildo%2Fpi-harness%2Fmain%2Fpackages%2Fweb%2Fpackage.json&query=%24.dependencies%5B%22pi-web-access%22%5D&label=pi-web-access&color=6E56CF" alt="pi-web-access"></a>
</p>

[pi-web-access](https://github.com/nicobailon/pi-web-access), by Nico Bailon, gives pi web search, page fetching and answers about a page. Out of the box, it searches with Exa, reads every page on your machine, and answers questions about a page with the model of your session, often the most expensive one you have. This package brings pi-web-access at one version that passed the harness's tests, and sets it up with the providers that did best when we measured them.

<p align="center"><code>pi install npm:@adeildo/pi-web</code></p>

`@adeildo/pi-harness` brings it too. The tools, commands and options are all pi-web-access's own, so [its README](https://github.com/nicobailon/pi-web-access#readme) is the manual for them.

## What changes

On your first session, the harness writes three keys into pi-web-access's `web-search.json`, and a line in the chat says which ones:

```json
{
	"searchRouting": {
		"providers": ["exa", "keenable", "parallel-mcp"],
		"fallbackOn": ["transient", "quota", "network", "invalid-response", "empty"]
	},
	"fetchRouting": {
		"providers": ["http", "jina", "parallel-mcp"],
		"allowRemoteHostedProviders": true
	},
	"fetch": { "answerProvider": "deepseek", "answerModel": "deepseek-flash" }
}
```

Searches still go to Exa first, which was the only provider with no off-topic link in our searches. When Exa fails or finds nothing, Keenable answers, and then Parallel. Pages are still read on your machine first. A page that hides its text behind a script, like the ANPD's incident page on gov.br, goes to Jina next, which reads it without a key. Questions about a page go to DeepSeek Flash, which answered as well as Opus in half the time. If you have no DeepSeek login, they go to GPT-6 Luna on your ChatGPT plan. With neither, the harness writes no answer model and checks again next session.

A key you already have stays as you set it, and a key you delete is not written back. The file is `~/.pi/agent/web-search.json`, unless `PI_CODING_AGENT_DIR` or `XDG_CONFIG_HOME` point pi-web-access somewhere else.

pi-web-access has no fallback between answer models, so when DeepSeek is down, the answer fails instead of going to GPT-6 Luna.

## Whose accounts it uses

| Part                                                     | Account                                                 | Cost                                                  |
| -------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------- |
| Search on Exa, Keenable and Parallel, fetching on Jina   | None. Public endpoints, limited per IP                  | Free. Your queries and the pages you fetch reach them |
| Answers about a page                                     | Your DeepSeek key, else your ChatGPT plan through Codex | DeepSeek's price per token, or your Codex usage limit |
| Search summaries, with `workflow: "auto-summary"`        | Claude Haiku 4.5 on your Anthropic login                | Your Claude plan                                      |
| `provider: "deepseek"`, only when you ask for it by name | Your DeepSeek key                                       | US$ 0.75 per 1,000 searches                           |

## With pi-web-access installed on its own

If your pi settings already list pi-web-access, as `npm:pi-web-access` or from git, pi would get every tool twice. So this package does not load its copy, and says so once. The config above is still written, and your copy reads it too. To use the version pinned here, remove the other package from your settings.

## The pinned version

Every day, a workflow tries the newest pi-web-access. When `bun run verify` passes against it, a pull request moves the pin; when it fails, an issue says why. The test that matters most there hands the harness's config to the new version's own checks, so a release that renames a key or reads the file from another place stops at the issue.

[How it works](docs/how-it-works.md) has the measurements behind each choice.

pi-web-access is Nico Bailon's work, under the MIT license. A problem with a tool belongs in [its issues](https://github.com/nicobailon/pi-web-access/issues), and a problem with the config or the pin in [ours](https://github.com/felipeadeildo/pi-harness/issues).

<!-- docs:footer -->

<p align="center">
  <a href="https://adeildo.dev"><img src="https://adeildo.dev/assets/images/cat.svg" width="42" height="42" alt="adeildo.dev"></a><br>
  <a href="https://github.com/felipeadeildo/pi-harness">pi-harness</a> is made by <a href="https://adeildo.dev">adeildo.dev</a>
</p>

<!-- /docs -->
