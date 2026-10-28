<h1 align="center">@adeildo/pi-ask-permission</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/@adeildo/pi-ask-permission"><img src="https://img.shields.io/npm/v/@adeildo/pi-ask-permission" alt="npm"></a>
  <a href="https://pi.dev"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Ffelipeadeildo%2Fpi-harness%2Fmain%2Fpackage.json&query=%24.devDependencies%5B%22%40earendil-works%2Fpi-coding-agent%22%5D&label=pi%20SDK&color=6E56CF" alt="pi SDK"></a>
</p>

Out of the box, pi runs every command the model writes. With this package, pi asks you first. You answer `yes`, `always yes` or `no`, and you can leave a note on any answer. The model reads the note, so a `no` can tell it what to do instead. In `judge` mode, a small model answers the routine calls for you.

```bash
pi install npm:@adeildo/pi-ask-permission
```

<!-- docs:ask-permission/preview -->

<p align="center">
  <img src="https://raw.githubusercontent.com/felipeadeildo/pi-harness/main/packages/ask-permission/assets/preview.png" alt="The permission dialog for npm install, with the reason it asks, the three answers, and a note on no: use pnpm instead." width="420">
  <img src="https://raw.githubusercontent.com/felipeadeildo/pi-harness/main/packages/ask-permission/assets/remember.png" alt="After always yes, the dialog asks which calls to remember: this exact call, or every pnpm call." width="420">
  <br>
  <em>No, with a note the model reads: use pnpm instead. Always yes asks what to remember.</em>
</p>

<!-- /docs -->

## The ask

The dialog opens before the command runs. `Enter` picks the answer under the cursor, and `Esc` cancels, which counts as no. `Tab` writes a note on the answer under the cursor, and a note on `no` becomes the reason that the model reads. When a command is longer than three lines, the dialog shows the first three and how many lines are left.

Reads inside the project never ask. That covers `read`, `grep`, `find`, `ls`, and shell commands that only read, like `cat`, `git log` or `rg`. For an `edit` or a `write`, the dialog shows the diff.

The dialog comes from [`@adeildo/pi-ask-questions`](../ask-questions), so a permission ask and a question from the model use the same keys and keep the same notes. When that package is off in `pi config`, or pi runs in an RPC host that cannot draw a terminal component, pi asks with its own selector instead, with the same answers and no panel.

## Always yes

When you pick `always yes`, the dialog asks what to remember, then for how long. The first option is the narrowest one, and it is the one to prefer: remembering `pnpm` would also approve `pnpm publish`.

| Scope        | How long it lasts                        | Where it is stored                                         |
| ------------ | ---------------------------------------- | ---------------------------------------------------------- |
| this session | Until the session ends, reloads included | The session file                                           |
| this project | Every session in this project            | `.pi/extensions/pi-ask-permission/always-yes.json`         |
| everywhere   | Every session                            | `~/.pi/agent/extensions/pi-ask-permission/always-yes.json` |

The `Always yes` section of the settings counts the rules in each scope and lets you forget them.

## Modes

`Alt+M` switches between modes, and the status bar shows the current one.

| Mode     | What runs without asking                                                   |
| -------- | -------------------------------------------------------------------------- |
| `manual` | Reads and the calls you marked always yes. This is the default             |
| `edits`  | The same, plus file edits and writes                                       |
| `judge`  | The same as `edits`, and the [judge](#let-a-model-decide) answers the rest |
| `full`   | Everything                                                                 |

Some calls ask you in every mode except `full`, even past an always yes and the judge. These are the calls that touch the protected list, such as the remote's key or its socket.

The workspace comes before the mode. A call outside `workspace.roots` asks you in every mode, `full` included. `Alt+W` lets calls outside the workspace through for the rest of the session, and the status bar shows `anywhere` in red while that is on. Press it again to turn the check back on. A resumed session keeps its mode and this choice.

### A folder next door

In a monorepo, a session in `apps/api` that reads `apps/web` leaves the workspace. The dialog says so, and offers to open the repository for reads.

<!-- docs:ask-permission/folder -->

<p align="center">
  <img src="https://raw.githubusercontent.com/felipeadeildo/pi-harness/main/packages/ask-permission/assets/folder.png" alt="A read outside the workspace, with an answer that also allows reads in that folder." width="860">
  <br>
  <em>A read outside the workspace can open that folder for reads.</em>
</p>

<!-- /docs -->

If you accept, the next reads there run without asking, for as long as you choose. A write outside the workspace gets `yes, and add … to the workspace` instead, and a folder that you opened for reads never lets a write through. The dialog never offers your home folder or a folder above it. The status bar counts the open folders, like `+1 folder`, and the `Folders` section of the settings closes them.

### A call to an MCP server

Pi registers each tool of an MCP server as `mcp__<server>__<tool>`, and the settings have a row for each server.

| Policy        | What runs without asking                                                        |
| ------------- | ------------------------------------------------------------------------------- |
| `ask me`      | Nothing, in any mode                                                            |
| `trust hints` | The calls that the server marks as read-only. The rest follows the current mode |
| `allow`       | Every call                                                                      |
| `deny`        | Nothing, whatever the mode                                                      |

`trust hints` is the default. The hint is what the server claims about its own tool, and pi does not check it, so put a server that you do not fully trust on `ask me`. Both `deny` and `ask me` win over the mode, `full` included. The dialog names the server, repeats what the server claims, and tells you when a script made the call.

## Let a model decide

In `judge` mode, a model answers every call that is not a read or an edit, so you only see the calls it is unsure about. A good way to start:

1. Run `/login typesafe` to use Jev, the default judge. Jev is a classifier model: it answers typed questions with a confidence instead of chatting. Pi also offers Jev through OpenRouter, Cloudflare, Vercel and opencode, and a local llama.cpp model works too. Pick one in `Model`.
2. Switch to `judge` with `Alt+M`, open `Alt+S`, and turn on `Dry run` in the Judge section. The judge then writes its verdict on each call, and you still decide.
3. Pick a policy. `Standard development` allows edits, tests, builds and local git, and asks about installs, the network and anything destructive.
4. After a few sessions in which you agree with the judge, turn `Dry run` off.

A call runs when the judge approves it with at least the confidence of the rigor you picked, and its risk stays under the ceiling. Every other call comes to you.

| Rigor                | Confidence | Risk ceiling |
| -------------------- | ---------- | ------------ |
| `cautious`           | 85%        | 0.45         |
| `balanced` (default) | 70%        | 0.50         |
| `relaxed`            | 55%        | 0.60         |

Under each call, a line says who decided and why, like `judge approved  97% sure, risk 0.12` or `you said no › use pnpm instead`, and `Ctrl+O` adds the judge's numbers. When the model sends several calls at once, the judge reads them together, so each call shows its own answer while the dialog asks about the next one.

The policy is plain text, so you start from a preset and edit it:

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

`Always ask me` lists patterns that the judge never approves, like `git push*`. The judge also reads the session's name and your last three messages, to tell whether a call is a step of what you asked. It never reads the agent's own words, and nothing in your messages can override the policy or `Always ask me`. When calls come back as `the judge could not decide`, use `Test the judge` in the Judge section of the settings. It sends one request and reports the model, how long it took and the error.

## Limits

- Always yes matches text. For `cd /repo && pnpm test`, it offers `cd`, `cd /repo` and the whole line, not `pnpm test`.
- The read-only check is a classifier, not a sandbox. It refuses anything that it cannot prove harmless, so a few safe commands still ask.
- The judge is a model and can be wrong. It sees the tool call and your messages, so do not let it judge calls or messages with secrets that you would not send to its provider.
- If you need rules that never change and no person in the loop, use a sandbox instead.

The [reference](docs/reference.md) lists every setting, the exact order in which a call is decided, the limits in full, and the events that other extensions can listen to.

`pi-ask-permission` on npm is this same extension under an older name, and it reads the same settings, grants and sessions. To move, run `pi remove npm:pi-ask-permission` and install this one.

<!-- docs:footer -->

<p align="center">
  <a href="https://adeildo.dev"><img src="https://adeildo.dev/assets/images/cat.svg" width="42" height="42" alt="adeildo.dev"></a><br>
  <a href="https://github.com/felipeadeildo/pi-harness">pi-harness</a> is made by <a href="https://adeildo.dev">adeildo.dev</a>
</p>

<!-- /docs -->
