<h1 align="center">@adeildo/pi-ask-permission</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/@adeildo/pi-ask-permission"><img src="https://img.shields.io/npm/v/@adeildo/pi-ask-permission" alt="npm"></a>
  <a href="https://pi.dev"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Ffelipeadeildo%2Fpi-harness%2Fmain%2Fpackage.json&query=%24.devDependencies%5B%22%40earendil-works%2Fpi-coding-agent%22%5D&label=pi%20SDK&color=6E56CF" alt="pi SDK"></a>
</p>

Out of the box, pi runs every command the model writes. With this package, pi asks you first. You answer `yes`, `always yes` or `no`, and you can leave a note on any answer. The model reads the note, so a `no` can tell it what to do instead. In `judge` mode, a small model answers the routine calls for you.

<p align="center"><code>pi install npm:@adeildo/pi-ask-permission</code></p>

<!-- docs:ask-permission/preview -->

<p align="center">
  <img src="https://raw.githubusercontent.com/felipeadeildo/pi-harness/main/packages/ask-permission/assets/preview.png" alt="The permission dialog for npm install, with the reason it asks, the three answers, and a note on no: use pnpm instead." width="860">
  <br>
  <img src="https://raw.githubusercontent.com/felipeadeildo/pi-harness/main/packages/ask-permission/assets/remember.png" alt="After always yes, the dialog asks which calls to remember: this exact call, or every pnpm call." width="860">
  <br>
  <em>No, with a note the model reads: use pnpm instead. Always yes asks what to remember.</em>
</p>

<!-- /docs -->

## Answering

The dialog opens before the command runs.

- `yes` runs it once.
- `always yes` runs it, and stops asking for the same command in this session, this project or everywhere.
- `no` blocks it. Press `Tab` first to add a note, like "use pnpm instead", and the model reads it.

Reads never ask, and for an edit you see the diff before you answer.

## Modes

`Alt+M` switches between modes, and the status bar shows the current one.

| Mode     | What runs without asking                           |
| -------- | -------------------------------------------------- |
| `manual` | Reads, and what you marked always yes. The default |
| `edits`  | The same, plus file edits and writes               |
| `judge`  | The same as `edits`, and a model answers the rest  |
| `full`   | Everything                                         |

A call outside your project asks you in every mode, `full` included. `Alt+W` lets those through for the rest of the session.

## Let a model decide

In `judge` mode, a small model reads each call and lets through the ones it is sure about. You only see the calls it doubts.

1. Run `/login typesafe` to use Jev, the default judge.
2. Switch to `judge` with `Alt+M`, and turn on `Dry run` in `Alt+S`. The judge writes its verdict on each call, but you still decide.
3. Pick a policy, such as `Standard development`.
4. Once you agree with the judge for a few sessions, turn `Dry run` off.

Every call shows who let it run and why, like `judge approved  97% sure, risk 0.12`.

## Learn more

- [How it works](docs/how-it-works.md): always yes in detail, folders outside the project, MCP servers, how the judge decides, and the limits.
- [Reference](docs/reference.md): every setting, the exact order in which a call is decided, and the events other extensions can listen to.

<!-- docs:footer -->

<p align="center">
  <a href="https://adeildo.dev"><img src="https://adeildo.dev/assets/images/cat.svg" width="42" height="42" alt="adeildo.dev"></a><br>
  <a href="https://github.com/felipeadeildo/pi-harness">pi-harness</a> is made by <a href="https://adeildo.dev">adeildo.dev</a>
</p>

<!-- /docs -->
