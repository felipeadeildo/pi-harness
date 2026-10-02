# Permission reference

Everything the [README](../README.md) leaves out: the keys, every setting, the order in which a call is decided, the limits, and the hooks for other extensions.

## Dialog keys

These are the keys of the permission dialog. With [`@adeildo/pi-ask-questions`](../../ask-questions) installed, that package draws it, and its keys are listed on its page. The classic dialog below is the fallback.

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

## Configuration

The settings live in the file every piece shares, `~/.pi/agent/extensions/pi-harness/settings.json`, under a `permission.` prefix. Most keys have a row on the settings screen (`Alt+S`), which shows the key under its description. `mcp.servers` gets one row per connected server, and the finer judge keys live in the file only. Only what you change is written, so a new default reaches you.

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

### The judge block

| Key                 | Default        | Does                                                                                                                                  |
| ------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `model`             | `"jev-latest"` | A name that starts with `jev` goes to TypeSafe. Anything else is a pi model, as `provider/modelId` or a bare id                       |
| `policy`            | Standard       | The rules the judge follows                                                                                                           |
| `alwaysAsk`         | `[]`           | Patterns the judge never approves, like `"git push*"`. A pattern matches the tool name too, so `mcp__*` catches every MCP call        |
| `rigor`             | `"balanced"`   | `"cautious"`, `"balanced"`, or `"relaxed"`. Sets `thresholds` and `riskCeiling`                                                       |
| `dryRun`            | `false`        | Show the verdict, and still ask you                                                                                                   |
| `thresholds`        | from `rigor`   | Confidence needed to allow / deny. File only. Set here, it wins over `rigor`, and the Rigor row reads `custom` until you pick a rigor |
| `riskCeiling`       | from `rigor`   | Highest risk the judge may approve. File only, and it wins over `rigor` the same way                                                  |
| `canDeny`           | `true`         | A confident no blocks the call. Off, it asks you. File only                                                                           |
| `whenUnsure`        | `"ask"`        | `"ask"`, `"allow"`, or `"deny"`. File only                                                                                            |
| `whenItFails`       | `"ask"`        | The same, for a timeout, an error, or a missing key. File only                                                                        |
| `noUI`              | `false`        | Also judge print, JSON, and subagent runs. File only                                                                                  |
| `rememberApprovals` | `false`        | A judge approval becomes always yes for this session. File only                                                                       |
| `timeoutMs`         | `5000`         | How long to wait for an answer. File only                                                                                             |
| `cache`             | `true`         | Reuse a verdict for the same call and the same last message in one session. File only                                                 |

A malformed value falls back and says what it dropped, so a typo never lets more through. Keys under an older name are read under the current one. `PI_CODING_AGENT_DIR` moves the file with the rest of the agent directory.

`judge.enabled`, `judge.tools`, and `judge.provider` are gone. A session that finds them removes them from the file and says so. If `judge.enabled` was `true` and no `mode` was set, it writes `"mode": "judge"`. If `~/.pi/agent/extensions/pi-ask-permission/config.json` exists, the next session reads it, writes what you set there into the shared settings, and renames it to `config.json.bak`.

## How a call is decided

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

## Limits

- Always yes matches text. `cd /repo && pnpm test` offers `cd`, `cd /repo`, and the whole line, not `pnpm test`.
- A bash path hidden behind `$HOME`, `$SECRET`, or `"$@"` counts as outside in `manual` and `edits`. In `judge` the judge decides it, even when the command only reads. In `full` it runs. Redirects to `/dev/null` and the other device files stay inside.
- The read-only check is a classifier, not a sandbox. It trusts the command name as written and does not resolve `PATH`. It refuses anything it cannot prove harmless, so a few safe commands still ask.
- The judge is a model, and it can be wrong. It sees the tool call and your last message, so do not judge calls or messages that carry secrets you would not send to its provider.
- Pi's `codemode` tool runs a script that calls other tools. The script itself does not ask, and every call it makes goes through the same steps on its own, saying so in the dialog.
- For deterministic rules and no human in the loop, use a sandbox instead.

## For other extensions

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

## Compatibility

Tested against the pi SDK pinned in `devDependencies`, which the `pi SDK` badge shows. CI checks each new pi release. The peer range is `*` because pi, not npm, picks the SDK that loads the extension.
