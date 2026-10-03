<h1 align="center">@adeildo/pi-ask-permission</h1>

<p align="center">
  <a href="https://github.com/felipeadeildo/pi-harness/actions/workflows/ci.yml"><img src="https://github.com/felipeadeildo/pi-harness/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://www.npmjs.com/package/@adeildo/pi-ask-permission"><img src="https://img.shields.io/npm/v/@adeildo/pi-ask-permission" alt="npm"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="license"></a>
  <a href="https://pi.dev"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Ffelipeadeildo%2Fpi-harness%2Fmain%2Fpackage.json&query=%24.devDependencies%5B%22%40earendil-works%2Fpi-coding-agent%22%5D&label=pi%20SDK&color=6E56CF" alt="pi SDK"></a>
</p>

Pi runs every tool call without asking. This extension asks first.

Answer `yes`, `always yes` or `no`, and leave a note if you want. The note reaches the model with the result, so denying `npm install` with "use pnpm instead" corrects the agent without stopping it. A judge model can answer the routine calls for you, so you only see the ones it doubts.

## Install

```bash
pi install npm:@adeildo/pi-ask-permission
```

There is nothing to configure, and the dialog comes with it. It also comes in [`@adeildo/pi-harness`](../harness), with the rest of the pieces.

`pi-ask-permission` on npm is this same extension under an older name, and it reads the same settings, grants and sessions. To switch, run `pi remove npm:pi-ask-permission` and install this one.

## The dialog

Ask the agent to do something that writes, like `run the tests`. The dialog opens before the command runs:

<!-- docs:ask-permission/preview -->

<p align="center">
  <img src="https://raw.githubusercontent.com/felipeadeildo/pi-harness/main/packages/ask-permission/assets/preview.png" alt="The permission dialog for npm install, with the reason it asks, the three answers, and a note on no: use pnpm instead." width="860">
  <br>
  <em>No, with a note the model reads: use pnpm instead.</em>
</p>

<!-- /docs -->

`enter` picks the highlighted answer and `esc` cancels, which denies. `tab` writes a note on the highlighted answer, and the note on `no` is the reason the model reads. A command longer than three lines shows its first three and how many are left.

Reads inside the project never ask: `read`, `grep`, `find`, `ls`, and bash commands that only read, like `cat`, `git log` or `rg`. An `edit` or `write` shows the diff it would make.

This is the dialog of [`@adeildo/pi-ask-questions`](../ask-questions), which comes with this package, so the permission ask and the model's questions share the same keys and notes. If you switch that feature off in `pi config`, and in RPC hosts that cannot draw a terminal component, Pi asks through its own selector, with the same answers and no panel.

## Stop answering the same question

Pick `always yes` and it asks what to remember, then for how long:

<!-- docs:ask-permission/remember -->

<p align="center">
  <img src="https://raw.githubusercontent.com/felipeadeildo/pi-harness/main/packages/ask-permission/assets/remember.png" alt="After always yes, the dialog asks which calls to remember: this exact call, or every pnpm call." width="860">
  <br>
  <em>Always yes asks which calls to remember.</em>
</p>

<!-- /docs -->

The first option is the narrowest, and that is the one to prefer: `pnpm` would also approve `pnpm publish`.

| Scope        | Lasts                                    | Stored in                                                  |
| ------------ | ---------------------------------------- | ---------------------------------------------------------- |
| this session | until the session ends, reloads included | the session file                                           |
| this project | every session in this project            | `.pi/extensions/pi-ask-permission/always-yes.json`         |
| everywhere   | every session                            | `~/.pi/agent/extensions/pi-ask-permission/always-yes.json` |

The `Always yes` section of the settings (`Alt+S`) shows how many rules each scope holds, and forgets them.

## Let the agent work

`Alt+M` switches modes, and the status bar shows the one you are in.

| Mode     | Runs without asking                                                        |
| -------- | -------------------------------------------------------------------------- |
| `manual` | reads (`allow` and read-only bash) and always yes                          |
| `edits`  | the same, plus file edits and writes                                       |
| `judge`  | the same as `edits`, and the [judge](#let-a-model-decide) decides the rest |
| `full`   | everything                                                                 |

The workspace comes before the mode. A call outside `workspace.roots` asks you in every mode, even `full`. `Alt+W` lets calls outside through for this session, and a second press puts the check back. The status bar shows `anywhere` in red while it is off. A resumed session keeps its mode and its `Alt+W` choice.

### A folder next door

In a monorepo, a session in `apps/api` that reads `apps/web` leaves the workspace. The dialog says so and offers to open the repository for reads:

<!-- docs:ask-permission/folder -->

<p align="center">
  <img src="https://raw.githubusercontent.com/felipeadeildo/pi-harness/main/packages/ask-permission/assets/folder.png" alt="A read outside the workspace, with an answer that also allows reads in that folder." width="860">
  <br>
  <em>A read outside the workspace can open that folder for reads.</em>
</p>

<!-- /docs -->

Take it and the next reads there run without asking, for as long as you choose. A write outside gets `yes, and add … to the workspace` instead. A folder opened for reads never lets a write through, and the dialog never offers your home or a folder above it. The status bar counts the open folders, like `+1 folder`, and the `Folders` section of the settings closes them.

### Calls to an MCP server

Pi registers each tool an MCP server offers as `mcp__<server>__<tool>`. The settings have a row per server, and each follows a policy:

| Policy        | Runs without asking                                                        |
| ------------- | -------------------------------------------------------------------------- |
| `ask me`      | Nothing, in any mode. Every call comes to you                              |
| `trust hints` | A call the server declares read-only. The rest follows the mode you are in |
| `allow`       | Every call                                                                 |
| `deny`        | Nothing. Every call is blocked, whatever the mode says                     |

`trust hints` is the default, and the hint is what the server claims about its own tool. Pi does not verify it, so a server you do not fully trust belongs on `ask me`. `deny` and `ask me` outrank the mode, `full` included. The dialog names the server, repeats what it declares, and says when a script issued the call.

## Let a model decide

In the `judge` mode a model answers every call that is not a read or an edit, and you only see the ones it is unsure about. A good way in:

1. Run `/login typesafe` to use Jev, the default judge. It is a classifier model: it answers typed questions with a confidence instead of chatting. Pi ships Jev through OpenRouter, Cloudflare, Vercel and opencode as well, and a llama.cpp model works too. Pick one in `Model`.
2. Switch to `judge` with `Alt+M`, open the settings with `Alt+S`, and turn on `Dry run` in `Judge`. The judge now writes its verdict on the call, and you still decide.
3. Pick a policy. `Standard development` allows edits, tests, builds and local git, and asks about installs, network and anything destructive.
4. After a few sessions of agreeing with it, turn off `Dry run`.

A call runs when the judge approves it with at least the confidence of the rigor you picked, and its risk stays under the ceiling. Anything else asks you.

| Rigor                  | Confidence | Risk ceiling |
| ---------------------- | ---------- | ------------ |
| `cautious`             | 85%        | 0.45         |
| `balanced`, by default | 70%        | 0.50         |
| `relaxed`              | 55%        | 0.60         |

A line under each call says who decided and why, like `judge approved  97% sure, risk 0.12` or `you said no › use pnpm instead`, and `ctrl+o` shows the judge's numbers. A read inside the project runs without a line. When the model sends several calls at once, the judge reads them together, so each call shows its own answer while the dialog asks about the next.

The policy is plain text, so start from a preset and edit it:

```text
# May run without asking
- Running tests, linters, type checks, and builds
- git status, diff, log

# Must always ask first
- sudo, or anything that changes system-wide state
- Anything that reaches the network

# When in doubt
Ask me.
```

`Always ask me` lists patterns the judge never approves, like `git push*`. The judge also reads your last message to tell whether a call is a step of what you asked, but nothing in the message overrides the policy or `Always ask me`. If calls come back as `the judge could not decide`, run `Test the judge` in the `Judge` section: it sends one request and reports the model, the latency and the error.

## Limits

- Always yes matches text. `cd /repo && pnpm test` offers `cd`, `cd /repo` and the whole line, not `pnpm test`.
- The read-only check is a classifier, not a sandbox. It refuses anything it cannot prove harmless, so a few safe commands still ask.
- The judge is a model and can be wrong. It sees the tool call and your last message, so do not judge calls that carry secrets you would not send to its provider.
- For deterministic rules and no human in the loop, use a sandbox.

## More

The [reference](docs/reference.md) has every setting, the exact order in which a call is decided, the full list of limits, and the events other extensions can listen to. The settings screen (`Alt+S`) covers the same keys without opening the file.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Commits follow [Conventional Commits](https://www.conventionalcommits.org), and [release-please](https://github.com/googleapis/release-please) publishes.

## License

[MIT](LICENSE) © adeildo
