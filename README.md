<h1 align="center">pi-harness</h1>

<p align="center">
  <a href="https://github.com/felipeadeildo/pi-harness/actions/workflows/ci.yml"><img src="https://github.com/felipeadeildo/pi-harness/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://www.npmjs.com/package/@adeildo/pi-harness"><img src="https://img.shields.io/npm/v/@adeildo/pi-harness" alt="npm"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="license"></a>
  <a href="https://pi.dev"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Ffelipeadeildo%2Fpi-harness%2Fmain%2Fpackage.json&query=%24.devDependencies%5B%22%40earendil-works%2Fpi-coding-agent%22%5D&label=pi%20SDK&color=6E56CF" alt="pi SDK"></a>
</p>

<p align="center">
  <strong>Pi runs every command without asking. This makes it ask.</strong><br>
  A set of extensions on top of <a href="https://pi.dev">Pi</a>, in one install: they ask before running something, they ask you before guessing, and the screen tells you what is happening.
</p>

<p align="center"><code>pi install npm:@adeildo/pi-harness</code></p>

<!-- docs:harness/preview -->

<p align="center">
  <img src="https://raw.githubusercontent.com/felipeadeildo/pi-harness/main/packages/harness/assets/preview.png" alt="A bash command in a box, with the reason it was allowed, what it printed, and the time it took." width="860">
  <br>
  <em>A command the model wanted to run, and the reason it was allowed.</em>
</p>

<!-- /docs -->

## What changes

A command the model wants to run now shows up with who let it run and why. A small model reads the command first, and when it is sure the command is fine it runs and says how sure it was. When it is not sure, the command comes to you as a question with the reason it is asking, so you are not guessing either.

The answer always reaches you in the same place, with the same keys: yes, always yes, or no, and a note you can leave on any of them. The note goes to the model with the result, so saying no to `npm install` with "use pnpm instead" corrects it without stopping the session. The questions the model has go through the same dialog.

Nothing here is hidden and nothing is final. The screen shows the stopwatch, the cost, and how fast the model writes without moving the line you are typing on. Every choice can be undone from the settings screen (`Alt+S`), and each piece can be turned off on its own.

## What you get

| Piece                                 | What it does                                                                                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Permission](packages/ask-permission) | Asks before a command runs. A model answers the easy ones for you, with the reason on the command, and the ones it is not sure about come to you |
| [Questions](packages/ask-questions)   | The model asks instead of guessing, with options, a preview of what each one leads to, and a note on any of them                                 |
| [Look](packages/look)                 | The start screen, the editor with the branch and the model on its borders, and a box around each command with its output and how long it took    |
| [Providers](packages/providers)       | Bills Anthropic requests to the Claude plan you already pay for, and keeps several accounts with a switch to the next one when a limit hits      |

<!-- docs:look/call -->

<p align="center">
  <img src="https://raw.githubusercontent.com/felipeadeildo/pi-harness/main/packages/look/assets/call.png" alt="Three commands, each in its own box: a bash command with the reason it was allowed and the time it took, a file read, and a command still running." width="860">
  <br>
  <em>One command that ran, one a rule let through, and one still going.</em>
</p>

<!-- /docs -->

## One piece, or all of them

`@adeildo/pi-harness` brings every piece, and `pi config` turns any of them off. Each piece is also its own package: `pi install npm:@adeildo/pi-look` brings the screen and nothing else.

There is no fork. Everything installs on top of Pi, and `pi remove` puts Pi back the way it was.

## Where to read next

| You want                        | Read                                                 |
| ------------------------------- | ---------------------------------------------------- |
| Use a piece                     | The page of the piece, linked in the table above     |
| See a piece in pictures         | Its own page, each one has its own screenshots       |
| Look up a setting or a key      | `docs/reference.md` in the permission and look pages |
| Know what is planned            | [ROADMAP.md](ROADMAP.md)                             |
| Know what changed               | [CHANGELOG.md](CHANGELOG.md)                         |
| Build a piece, or send a change | [CONTRIBUTING.md](CONTRIBUTING.md)                   |

## License

[MIT](LICENSE) © adeildo
