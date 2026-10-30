# pi-web

Web search, page fetching and answers about a page, for pi. The tools come from [pi-web-access](https://github.com/nicobailon/pi-web-access) by [Nico Bailon](https://github.com/nicobailon), MIT licensed. This package adds three things to it: one version of it, tested against the harness before it ships; a config that picks providers by how they measured; and a check that the person who installed pi-web-access on their own keeps their copy.

```bash
pi install npm:@adeildo/pi-web
```

`@adeildo/pi-harness` brings it too. Every tool, command and option is pi-web-access's own, so [its README](https://github.com/nicobailon/pi-web-access#readme) is the manual.

## What the harness sets

On the first session, the harness writes these keys into pi-web-access's `web-search.json` (`~/.pi/agent/web-search.json` unless `PI_CODING_AGENT_DIR` or `XDG_CONFIG_HOME` say otherwise), and says which ones it wrote:

| Key                                            | Value                                                     | Why                                                                                                                          |
| ---------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `searchRouting`                                | `exa`, then `keenable`, then `parallel-mcp`               | Exa returned no off-topic link in 8 searches. Keenable was the fastest at 0.3 s. Parallel finds official pages               |
| `fetchRouting`                                 | `http`, then `jina`, then `parallel-mcp`                  | pi-web-access's own reader missed a gov.br page whose text sits behind a script, and Jina read it without a key              |
| `fetch.answerProvider` and `fetch.answerModel` | `deepseek/deepseek-flash`, else `openai-codex/gpt-6-luna` | Both answered 10 of 10 questions about a page in 2.1 s. The session's model, often the most expensive one, answers otherwise |

A key is written once, and only where the file has none: a value you set stays yours, and a key you delete is not written back. The answer model is the first of the two you are logged in to; with neither, the harness writes nothing and looks again next session. pi-web-access has no fallback between answer models, so if DeepSeek fails, the answer fails.

## Whose account each part uses

| Part                                                        | Account                                                           | Cost                                                           |
| ----------------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------- |
| Search on Exa, Keenable and Parallel, fetching through Jina | None, public endpoints limited per IP                             | Free. Your queries and the URLs you fetch reach those services |
| Answers about a page                                        | Your DeepSeek key, else your ChatGPT plan through the Codex login | Per token on DeepSeek; the Codex usage limit on ChatGPT        |
| Search summaries (`workflow: "auto-summary"`)               | pi-web-access's default, Claude Haiku 4.5 on your Anthropic login | Your Claude plan                                               |
| `provider: "deepseek"`                                      | Your DeepSeek key, when you ask for it by name                    | US$ 0.75 per 1,000 searches                                    |

## With pi-web-access installed on its own

pi would get every tool twice. When your pi settings list a pi-web-access package of their own, this one does not load its copy, says so once, and still writes the config above, which your copy reads too. Remove the other package to use the pinned version.

## The pinned version

`package.json` names one exact version of pi-web-access. Every day, a workflow tries the newest one: `bun run verify` runs, `test/contract.test.ts` included, which hands the harness's config to that version's own checks and fails when it refuses a key or reads the file from another place. A green run opens a pull request with the bump, and a red one opens an issue.

## The measurements

The numbers above come from one run on 2026-10-29, against the providers that need no key and DeepSeek: 8 searches, 5 claims (one of them false), one summary checked against 4 facts, 7 pages checked for 14 facts, and 5 questions about pages. A check counted when the answer or the page held the fact, read by a regular expression; "off-topic" in search is a judgement on the first four links.

| Task                           | Best                                                     | Next                                         |
| ------------------------------ | -------------------------------------------------------- | -------------------------------------------- |
| Search                         | Exa: 8 of 8 on topic, 0.7 s                              | Keenable: 8 of 8, 0.3 s                      |
| Evidence against a false claim | Keenable, DeepSeek and AnySearch found it                | Exa, Parallel, DuckDuckGo and degoog did not |
| Summary                        | Parallel: 4 of 4 facts, from official pages              | DuckDuckGo and degoog: 4 of 4                |
| Fetching                       | Exa: 13 of 14, but pi-web-access needs an Exa key for it | Local reader and Jina: 12 of 14              |
| Answers about a page           | `gpt-6-luna` and `deepseek-flash`: 10 of 10 in 2.1 s     | Haiku 4.5: 10 of 10 in 2.6 s                 |
