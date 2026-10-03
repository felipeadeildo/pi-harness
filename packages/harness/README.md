# @adeildo/pi-harness

[![npm](https://img.shields.io/npm/v/@adeildo/pi-harness)](https://www.npmjs.com/package/@adeildo/pi-harness)

Every extension adeildo runs [Pi](https://pi.dev) with, in one install.

```bash
pi install npm:@adeildo/pi-harness
```

<!-- docs:harness/preview -->

<p align="center">
  <img src="https://raw.githubusercontent.com/felipeadeildo/pi-harness/main/packages/harness/assets/preview.png" alt="A bash command in a box, with the reason it was allowed, what it printed, and the time it took." width="860">
  <br>
  <em>A command the model wanted to run, and the reason it was allowed.</em>
</p>

<!-- /docs -->

## What comes in it

| Piece                           | What it does                                                                                             |
| ------------------------------- | -------------------------------------------------------------------------------------------------------- |
| [Permission](../ask-permission) | Asks before a command runs, with a note the model reads. A model answers the easy ones for you           |
| [Questions](../ask-questions)   | The model asks instead of guessing, with options, a preview of each, a note on any and your own answer   |
| [Look](../look)                 | The start screen, the editor with the branch and the model on its borders, and a box around each command |
| [Providers](../providers)       | Bills Anthropic OAuth requests to your Claude plan, and keeps several accounts per provider              |

All of them are on once the package is installed.

> [!WARNING]
> Providers makes Pi introduce itself to Anthropic as Claude Code whenever a request uses an Anthropic OAuth token. Using a subscription from anything other than Claude Code may break Anthropic's terms. Turn it off, as below, if you do not want that. Requests with an API key go out untouched.

## Turn a piece off

Each piece is its own extension in this package. Run `pi config` and switch off the one you do not want, globally or for one project.

The settings file has a switch per feature too, read on the next `/reload`:

```json
{ "features": { "subscription": { "enabled": false } } }
```

The feature ids are `permission`, `look`, `subscription`, `accounts` and `questions`.

To have only one piece, install its own package instead. With both installed, the first copy that loads runs the feature and the other stays off.

## Settings

`Alt+S` opens the settings of every piece. They live in `~/.pi/agent/extensions/pi-harness/settings.json`. A setting marked _project_ is also read from `.pi/extensions/pi-harness/settings.json` in a project Pi trusts, and the project value wins. Each piece's page lists its settings.

## License

[MIT](LICENSE)
