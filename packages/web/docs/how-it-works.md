# How the web config was chosen

The [README](../README.md) covers what this package sets. This page shows the measurements behind it.

We ran each of pi-web-access's jobs against the providers that need no key (Exa, Keenable, Parallel, DuckDuckGo, degoog and AnySearch) and against DeepSeek, on one day in October 2026. No provider was the best at every job, so the config picks one per job. The runs are small: 8 searches, 5 claims, one summary, 7 pages and 5 questions. Treat a gap of one point as noise.

## Exa searches cleanest, and Keenable fastest

Each provider ran the same 8 searches, and we read the first four links of each. They included an ambiguous one ("bun test mutation testing"), a niche one about pi's own API, and one in Portuguese about the ANPD.

| Provider   | On topic | Median time |
| ---------- | -------- | ----------- |
| Exa        | 8 of 8   | 0.70 s      |
| Keenable   | 8 of 8   | 0.32 s      |
| DeepSeek   | 7 of 8   | 0.79 s      |
| Parallel   | 7 of 8   | 0.80 s      |
| DuckDuckGo | 7 of 8   | 2.0 s       |
| degoog     | 6 of 8   | 1.4 s       |
| AnySearch  | 6 of 8   | 3.2 s       |

DuckDuckGo read "bun" as the blood test. Parallel answered the xz backdoor search with share buttons and a broken link. That's why Exa stays first and Keenable comes second: it's as accurate on these searches and twice as fast.

## Only three providers found the evidence against a false claim

`source_check` gathers passages for a claim. Four of the five claims were true, and the fifth said Bun's runtime is written in Go. Every provider found evidence for the four true ones, but only Keenable, DeepSeek and AnySearch brought back a passage saying Bun is written in Zig. For a claim you doubt, ask for `provider: "keenable"`.

## Summaries are as good as the pages behind them

A summary is written by Claude Haiku 4.5 whatever the provider, so the provider only changes what Haiku reads. We asked each one about DeepSeek's search API and checked four facts: the price, the rate limits of 100 and 25 requests per second, that only successful requests are billed, and that calls through Claude Code are free until November 2026.

Parallel got all four, because it returned DeepSeek's own documentation in full. Exa, Keenable and DeepSeek gave a limit of 5 requests per second, an older number that blog posts still repeat. AnySearch's summary invented a price per token. For a summary you will act on, ask for `provider: "parallel-mcp"`.

## Reading a page fails on a few sites, and Jina covers them

Each reader fetched 7 pages, and we looked for two facts on each.

| Reader                 | Facts found | Missed                               |
| ---------------------- | ----------- | ------------------------------------ |
| Exa                    | 13 of 14    | one detail on ratatui's page         |
| pi-web-access, locally | 12 of 14    | the ANPD's page on gov.br            |
| Jina                   | 12 of 14    | the arXiv PDF, which refused it      |
| Parallel               | 10 of 14    | gov.br, and returns up to 157k chars |
| DeepSeek               | 10 of 14    | gov.br and the PDF, in up to 15 s    |

Exa read best, but pi-web-access only fetches through Exa with an Exa API key. So the config keeps the local reader first, which is free and private, and sends only the pages it fails on to Jina, which read gov.br without a key.

## A small model answers about a page as well as Opus

In answer mode, a model reads the fetched page and answers one question. Five questions had 10 facts in all.

| Model                        | Facts    | Time  |
| ---------------------------- | -------- | ----- |
| `deepseek/deepseek-flash`    | 10 of 10 | 2.1 s |
| `openai-codex/gpt-6-luna`    | 10 of 10 | 2.1 s |
| `anthropic/claude-haiku-4-5` | 10 of 10 | 2.6 s |
| `xai/grok-4.7`               | 10 of 10 | 3.9 s |
| Opus 5.5, the session's      | 10 of 10 | 3.9 s |
| `anthropic/claude-haiku-5-5` | 9 of 10  | 2.5 s |

Opus is what answers when nothing is set, and it was among the slowest and costs the most. DeepSeek Flash comes first because it costs fractions of a cent per answer and leaves your plans alone; GPT-6 Luna comes next for when there is no DeepSeek login.

## Checking the config against each new version

`test/contract.test.ts` writes the harness's config into a temporary folder and runs pi-web-access's own code against it, in a process of its own: the search routing must come back as written, the fetch routing must not be refused, and the answer model it looks for must be DeepSeek Flash. A second test breaks the fetch routing on purpose and expects the refusal, so a pass means the check really ran. The daily workflow runs these against each new pi-web-access before the pin moves.
