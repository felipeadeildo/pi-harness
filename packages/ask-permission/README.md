<h1 align="center">@adeildo/pi-ask-permission</h1>

<p align="center">
  <a href="https://github.com/felipeadeildo/pi-harness/actions/workflows/ci.yml"><img src="https://github.com/felipeadeildo/pi-harness/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://www.npmjs.com/package/@adeildo/pi-ask-permission"><img src="https://img.shields.io/npm/v/@adeildo/pi-ask-permission" alt="npm"></a>
  <a href="https://www.npmjs.com/package/@adeildo/pi-ask-permission"><img src="https://img.shields.io/npm/dm/@adeildo/pi-ask-permission" alt="downloads"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="license"></a>
  <a href="https://www.npmjs.com/package/@adeildo/pi-ask-permission"><img src="https://img.shields.io/badge/provenance-signed-success" alt="provenance"></a>
  <a href="https://pi.dev/packages/@adeildo/pi-ask-permission"><img src="https://img.shields.io/badge/pi--package-6E56CF" alt="pi package"></a>
  <a href="https://pi.dev"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Ffelipeadeildo%2Fpi-harness%2Fmain%2Fpackage.json&query=%24.devDependencies%5B%22%40earendil-works%2Fpi-coding-agent%22%5D&label=pi%20SDK&color=6E56CF" alt="pi SDK"></a>
</p>

Pi runs every tool call without asking. This extension asks first.

Answer `yes`, `always yes`, or `deny`, and add a note if you want. The note reaches the model with the result, so denying `npm install` with `use pnpm instead` corrects the agent without stopping it.

<p align="center">
  <img src="https://raw.githubusercontent.com/felipeadeildo/pi-harness/main/packages/ask-permission/assets/preview.png" alt="The permission dialog for npm install, with the judge card above it and a note typed on the deny row: use pnpm instead." width="860">
</p>

## Install

```bash
pi install npm:@adeildo/pi-ask-permission
```

Then start pi as usual. There is nothing to configure. It also comes in [`@adeildo/pi-harness`](../harness), with the rest of the pieces.

`pi-ask-permission` on npm is this same extension under an older name, and it reads the same config, grants and sessions. To switch:

```bash
pi remove npm:pi-ask-permission
pi install npm:@adeildo/pi-ask-permission
```

## First run

Ask the agent to do something that writes, like `run the tests`. The dialog opens before the command runs:

```
╭─ permission · bash ──────────────────────────────────╮
│ pnpm test                                            │
│                                                      │
│ ❯ 1  yes                                             │
│   2  always yes                                      │
│   3  deny                                            │
│                                                      │
│ ↑↓ or 1-3 pick   enter confirm   tab note   esc deny │
╰──────────────────────────────────────────────────────╯
```

`enter` approves. `esc` denies. `tab` opens a note on the highlighted row.

Reads inside the project never ask. `read`, `grep`, `find`, `ls`, and bash commands that only read, like `cat`, `git log`, or `rg`, run on their own. An `edit` or `write` shows the diff it would make.

## Everyday use

### Stop answering the same question

Pick `always yes`, then choose how much to remember and for how long:

```
╭─ permission · bash ──────────────────────────────────╮
│ pnpm test                                            │
│                                                      │
│ always yes for...                                    │
│   pnpm                                               │
│ ❯ pnpm test                                          │
│                                                      │
│ scope: this session   (tab to change)                │
│                                                      │
│ ↑↓ depth   tab scope   enter confirm   esc back      │
╰──────────────────────────────────────────────────────╯
```

We recommend the narrowest level, which is preselected. `pnpm` would also approve `pnpm publish`.

| Scope        | Lasts                                    | Stored in                                                  |
| ------------ | ---------------------------------------- | ---------------------------------------------------------- |
| this session | until the session ends, reloads included | the session file                                           |
| this project | every session in this project            | `.pi/extensions/pi-ask-permission/always-yes.json`         |
| everywhere   | every session                            | `~/.pi/agent/extensions/pi-ask-permission/always-yes.json` |

The `Always yes` section of the settings screen shows how many rules each scope holds, and forgets them.

### Let the agent work

Press `Alt+M` to switch modes. The status bar shows the one you are in.

| Mode     | Runs without asking                                                        |
| -------- | -------------------------------------------------------------------------- |
| `manual` | reads (`allow` and read-only bash) and always yes                          |
| `edits`  | the same, plus file edits and writes                                       |
| `judge`  | the same as `edits`, and the [judge](#let-a-model-decide) decides the rest |
| `full`   | everything                                                                 |

The workspace comes before the mode. A call outside `workspace.roots` asks you in every mode, even `full`. `Alt+W` lets calls outside through for this session, and a second press puts the check back. The status bar shows `anywhere` in red while it is off.

A resumed session keeps its mode and its `Alt+W` choice. A new one starts from `mode` and `workspace.outside` in the settings.

### Read a folder next door

In a monorepo, a session in `apps/api` that reads `apps/web` leaves the workspace. The dialog says so and offers to open the repository for reads. The cursor starts on that answer:

```text
╭─ permission · bash ──────────────────────────────────────────╮
│ cd ~/Projects/grace/apps/web && git status --short | head    │
│ ▲ reads outside the workspace                                │
│                                                              │
│   1  yes                                                     │
│ ❯ 2  yes, and allow reads in ~/Projects/grace  repo root     │
│   3  always yes                                              │
│   4  deny                                                    │
│                                                              │
│ ←→ folder   s keep for this project   tab note   esc deny    │
╰──────────────────────────────────────────────────────────────╯
```

Press `enter` and the next reads in `~/Projects/grace` run without asking, until the session ends. `←` and `→` move the folder one level up or down. `s` keeps it for every session in this project, in `.pi/extensions/pi-ask-permission/folders.json`. An untrusted project keeps it only until pi exits.

A write outside gets `yes, and add … to the workspace` instead, and the cursor stays on `yes`. A folder opened for reads never lets a write through. The dialog never offers your home or a folder above it.

The status bar counts the open folders, like `+1 folder`. The `Folders` section of the settings screen closes them.

### Calls to an MCP server

Pi registers each tool an MCP server offers as `mcp__<server>__<tool>`. The settings screen has a row per server under `MCP servers`, and each one follows a policy of its own:

| Policy        | Runs without asking                                                        |
| ------------- | -------------------------------------------------------------------------- |
| `ask me`      | Nothing, in any mode. Every call comes to you                              |
| `trust hints` | A call the server declares read-only. The rest follows the mode you are in |
| `allow`       | Every call                                                                 |
| `deny`        | Nothing. Every call is blocked, whatever the mode says                     |

`trust hints` is the default, and the hint is what the server claims about its own tool. Pi does not verify it, so a server you do not fully trust belongs on `ask me`. A server that declares nothing reads as a writer, so with `trust hints` the mode decides: `manual` and `edits` ask, `judge` judges, `full` runs.

`deny` and `ask me` outrank the mode, `full` included. The `allow` list does not bring a denied server back.

The resource tools pi adds for reading resources name the server in their arguments rather than in the tool name, so no server policy covers them: `list_mcp_resources`, `list_mcp_resource_templates` and `read_mcp_resource`. They declare themselves read-only, so the read-only layer runs them whatever the mode.

The dialog names the server and repeats what it declares, and says when a script issued the call:

```text
╭─ permission · sauron:delete_dashboard ──────────────────────╮
│ {"uid":"abc","id":12}                                       │
│ sauron · destructive                                        │
│                                                             │
│   1  yes                                                    │
│   2  always yes                                             │
│ ❯ 3  deny                                                   │
╰─────────────────────────────────────────────────────────────╯
```

Pi's `codemode` tool runs a script that calls other tools, and `tool_search` loads a tool for the next call. Both run without asking, because every call they make reaches this gate on its own, and the dialog says it came from a script.

### Correct the agent

A note on `deny` tells the agent what to do instead. A note on `yes` adds context, like `and update the snapshot`. Both reach the model with the tool result.

If you are typing in the editor when a call arrives, the dialog waits until you pause.

## Let a model decide

In the `judge` mode, a model answers every call that is not a read or an edit. You only see the ones it is unsure about. We recommend this setup:

1. Run `/login typesafe` to use Jev, a fast model that answers with a confidence. Any model you set up in pi works too.
2. Switch to `judge` with `Alt+M`, open the settings with `Alt+S`, and turn on `Dry run` in `Judge`. The judge now shows its verdict as a card, and you still decide.
3. Pick a policy. `Standard development` allows edits, tests, builds, and local git, and asks about installs, network, and anything destructive.
4. After a few sessions of agreeing with it, turn off `Dry run`.

The policy is plain text, so you can start from a preset and edit it:

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

If calls come back as `the judge could not decide`, run `Test the judge` in the `Judge` section. It sends one request and reports the model, the latency, and the error.

## Settings

`Alt+S` opens them. The Permission tab:

| Section      | Has                                               |
| ------------ | ------------------------------------------------- |
| This session | Mode and outside policy for this session          |
| New sessions | The mode and outside policy a session starts with |
| Workspace    | The project folders                               |
| MCP servers  | One row per server, with its policy               |
| Reads        | Tools that never ask, read-only bash              |
| Dialog       | Notes, no-dialog behavior, typing pause           |
| Judge        | Model, policy, thresholds, a test, the log        |
| Always yes   | Rule counts, and forget                           |
| Folders      | Folders opened from the dialog, and close         |

Type to search. `Delete` resets a value.

## Reference

### Dialog keys

| Key                    | Does                                                 |
| ---------------------- | ---------------------------------------------------- |
| `↑` `↓` or `1` `2` `3` | Move the highlight                                   |
| `enter`                | Confirm the highlighted row                          |
| `←` `→`                | Pick the folder to open, on the folder row           |
| `s`                    | Keep the folder for this project, on the folder row  |
| `tab`                  | Open or close a note, or change the always yes scope |
| `esc`                  | Close the note, or deny                              |
| `ctrl+v`               | Paste a clipboard image as its file path             |

A long paste collapses to `[paste #1 +48 lines]` and expands when you confirm.

### Configuration

The settings live in the file every piece shares, `~/.pi/agent/extensions/pi-harness/settings.json`, under a `permission.` prefix. Every key has a row on the settings screen, which shows the key under its description, except `mcp.servers`, which gets one row per connected server. Only what you change is written, so a new default reaches you.

```json
{
	"permission": {
		"allow": ["read", "grep", "find", "ls"],
		"mode": "manual",
		"readOnlyBash": true,
		"workspace": { "roots": ["."], "outside": "ask" },
		"judge": { "model": "jev-latest" }
	}
}
```

The ids below leave out the `permission.` prefix.

| Key                 | Does                                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `allow`             | Tools that never ask. `mcp__*` matches a family. It matches the tool name, so `bash` allows every command. An MCP server policy comes first |
| `mode`              | The mode a new session starts in: `"manual"`, `"edits"`, `"judge"`, or `"full"`                                                             |
| `readOnlyBash`      | Run bash commands that only read without asking                                                                                             |
| `notes`             | `"result"` adds a note to the tool result. `"message"` sends it as its own message                                                          |
| `noUI`              | `"allow"` or `"deny"` when nobody can answer, as in print mode or a subagent. Takes a per-tool map: `{ "*": "allow", "bash": "deny" }`      |
| `workspace.roots`   | Paths that count as the project. Relative, absolute, and `~` work                                                                           |
| `workspace.outside` | Where a new session starts for a call outside the roots: `"ask"` you, `"deny"` it, or `"allow"` it like any other                           |
| `typing.pause`      | Milliseconds of quiet before the dialog opens while you type                                                                                |
| `typing.maxWait`    | The longest the dialog waits for you to stop typing. `null` waits forever                                                                   |
| `mcp.servers`       | The policy per MCP server, like `{ "sauron": "deny" }`. The row per server on the settings screen writes this one                           |

The `judge` block:

| Key                 | Default        | Does                                                                                                                           |
| ------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `provider`          | `"jev"`        | `"jev"`, or `"pi"` for a model you set up in pi                                                                                |
| `model`             | `"jev-latest"` | A Jev alias, or `provider/modelId` for a pi model                                                                              |
| `policy`            | Standard       | The rules the judge follows                                                                                                    |
| `canDeny`           | `true`         | A confident no blocks the call. Off, it asks you                                                                               |
| `whenUnsure`        | `"ask"`        | `"ask"`, `"allow"`, or `"deny"`                                                                                                |
| `whenItFails`       | `"ask"`        | The same, for a timeout, an error, or a missing key                                                                            |
| `alwaysAsk`         | `[]`           | Patterns the judge never approves, like `"git push*"`. A pattern matches the tool name too, so `mcp__*` catches every MCP call |
| `dryRun`            | `false`        | Show the verdict, and still ask you                                                                                            |
| `noUI`              | `false`        | Also judge print, JSON, and subagent runs                                                                                      |
| `rememberApprovals` | `false`        | A judge approval becomes always yes for this session                                                                           |
| `thresholds`        | `0.85` / `0.8` | Confidence needed to allow / deny                                                                                              |
| `riskCeiling`       | `0.45`         | Highest risk the judge may approve                                                                                             |
| `timeoutMs`         | `5000`         | How long to wait for an answer                                                                                                 |

A malformed value falls back and says what it dropped, so a typo never lets more through. Keys under an older name are read under the current one. `PI_CODING_AGENT_DIR` moves the file with the rest of the agent directory.

If `~/.pi/agent/extensions/pi-ask-permission/config.json` exists, the next session reads it, writes what you set there into the shared settings, and renames it to `config.json.bak`.

### How a call is decided

The first step that answers wins.

1. **Always yes** matches the tool and level: run it.
2. **Codemode**: `codemode` and `tool_search` themselves run. Every call inside is decided on its own.
3. **Workspace**: a call outside `workspace.roots` asks you, or is blocked with this session's outside set to `deny`. Nothing below can approve it. The call goes on with `allow`, or when every path it reaches is in a folder you opened.
4. **MCP**: the policy of the server. `deny` blocks, `allow` runs, `ask` asks, and `trust hints` decides nothing here.
5. **Read-only hint**: the tool declares that it only reads, run it.
6. **Mode**: `full` runs it, `edits` and `judge` run an edit.
7. **Allow list**: the tool is in `allow`, run it.
8. **Read-only bash**: the command only reads, and its paths can be read, run it.
9. **Judge**, in the `judge` mode: a confident yes runs it, a confident no blocks it.
10. **No UI**: `noUI` decides.
11. **Edit check**: an `edit` that cannot apply is blocked with pi's own error, so you never approve a failure.
12. **You**, in the dialog.

The judge answers three questions: a verdict, how reversible the call is, and whether it touches secrets. Code combines them into `risk = 0.6 × reversibility + 0.4 × sensitive` and approves only when the verdict is `allow`, confidence clears `thresholds.allow`, and risk is at most `riskCeiling`. The judge treats the tool call as data, so a command cannot talk its way past the policy or `alwaysAsk`.

### Limits

- Always yes matches text. `cd /repo && pnpm test` offers `cd`, `cd /repo`, and the whole line, not `pnpm test`.
- A bash path hidden behind `$HOME`, `$SECRET`, or `"$@"` counts as outside in `manual` and `edits`. In `judge` the judge decides it, even when the command only reads. In `full` it runs. Redirects to `/dev/null` and the other device files stay inside.
- The read-only check is a classifier, not a sandbox. It trusts the command name as written and does not resolve `PATH`. It refuses anything it cannot prove harmless, so a few safe commands still ask.
- The judge is a model, and it can be wrong. It sees the tool call, so do not judge calls that carry secrets you would not send to its provider.
- Pi's `codemode` tool runs a script that calls other tools. The script itself does not ask, and every call it makes goes through the same steps on its own, saying so in the dialog. The judge reads the arguments of an MCP call as data, like any other call.
- If you want deterministic rules and no human in the loop, use a sandbox instead.

### For other extensions

Every decision goes out on `pi.events`:

```ts
pi.events.on("pi-ask-permission:decided", (decided) => {
	// { toolCallId, toolName, summary, action: "allow" | "block", by, reason?, note? }
});
```

`by` names the step above that decided, `you` for the dialog, or `no UI`. Dialog answers are also saved in the session as `pi-ask-permission:answer` entries.

A custom tool can say what it touches, so the workspace and the `edits` mode treat it like `edit`. Emit from `session_start`, after every extension has loaded:

```ts
pi.on("session_start", () => {
	pi.events.emit("pi-ask-permission:tool", {
		name: "apply_patch",
		edits: true,
		paths: (input) => input.files,
	});
});
```

A tool that says nothing has no paths and is not an edit. Built-in tools cannot be redescribed.

### Compatibility

Tested against the pi SDK pinned in `devDependencies`, which the `pi SDK` badge shows. CI checks each new pi release. The peer range is `*` because pi, not npm, picks the SDK that loads the extension.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Commits follow [Conventional Commits](https://www.conventionalcommits.org), and [release-please](https://github.com/googleapis/release-please) publishes.

## License

[MIT](LICENSE) © adeildo
