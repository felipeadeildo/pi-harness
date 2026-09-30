# @adeildo/pi-harness

[![npm](https://img.shields.io/npm/v/@adeildo/pi-harness)](https://www.npmjs.com/package/@adeildo/pi-harness)

The extensions I run [Pi](https://pi.dev) with, in one package.

```bash
pi install npm:@adeildo/pi-harness
```

```
   0:12 · 3 calls · last call 1.7s wait · ↓906 tok/s
╭─ ⠋ Thinking · check the frame first ·  main* ──────────── ~/Projects/pi-harness ·  ghost ─╮
│ what you type                                                                             │
╰─ ⏵⏵ auto · anywhere · 󰚩 Anthropic/Claude Opus 5.5 · ▂▃▄▅ high ─── 󰍛 49% ━━━━━━━━ 489k/1M ─╯
  $0.497 sub · ↑368k in ↓1.7k out ·  98% cached · avg ↓290 ↑31k tok/s ·  mem 12
```

## Features

| Feature                        | What it does                                                                                                                                                                                   |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Look](docs/look.md)           | The start card, a framed editor with the branch, model and context in its borders, the strip with the time and speed of the answer, and the footer with the session's cost. Only theme colours |
| [Providers](docs/providers.md) | Bills Anthropic OAuth requests to the Claude Pro or Max plan instead of extra usage                                                                                                            |

Both are on once the package is installed.

> [!WARNING]
> Providers makes Pi introduce itself to Anthropic as Claude Code whenever a request uses an Anthropic OAuth token. Using a subscription from anything other than Claude Code may break Anthropic's terms. Turn it off, as below, if you don't want that. Requests with an API key go out untouched.

## Turn a feature off

Each feature is its own extension in the package manifest. Run `pi config` and switch off the one you don't want, globally or for one project.

The settings file has a switch per feature too, read on the next `/reload`:

```json
{ "features": { "subscription": { "enabled": false } } }
```

## Settings

Every feature reads `~/.pi/agent/extensions/pi-harness/settings.json`. A setting marked _project_ is also read from `.pi/extensions/pi-harness/settings.json` in a project Pi trusts, and the project value wins. Each feature's page lists its settings.

The permission dialog is a separate package, [`@adeildo/pi-ask-permission`](../ask-permission), and it reads the same file.

## License

[MIT](LICENSE)
