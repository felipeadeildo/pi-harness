# @adeildo/pi-harness

[![npm](https://img.shields.io/npm/v/@adeildo/pi-harness)](https://www.npmjs.com/package/@adeildo/pi-harness)

Every extension adeildo runs [Pi](https://pi.dev) with, in one install.

```bash
pi install npm:@adeildo/pi-harness
```

## What comes in it

| Piece                           | What it does                                                                                                     |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| [Permission](../ask-permission) | Asks before a tool call runs, with a note the model reads. A judge model answers the routine calls for you       |
| [Questions](../ask-questions)   | The model asks instead of guessing, with options, a preview of each, a note on any and your own answer           |
| [Look](../look)                 | The start card, a framed editor with the branch, model and context in its borders, and a screen that holds still |
| [Providers](../providers)       | Bills Anthropic OAuth requests to your Claude plan, and keeps several accounts per provider                      |

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
