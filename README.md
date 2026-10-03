<h1 align="center">pi-harness</h1>

<p align="center">
  <a href="https://github.com/felipeadeildo/pi-harness/actions/workflows/ci.yml"><img src="https://github.com/felipeadeildo/pi-harness/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://www.npmjs.com/package/@adeildo/pi-harness"><img src="https://img.shields.io/npm/v/@adeildo/pi-harness" alt="npm"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="license"></a>
  <a href="https://pi.dev"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Ffelipeadeildo%2Fpi-harness%2Fmain%2Fpackage.json&query=%24.devDependencies%5B%22%40earendil-works%2Fpi-coding-agent%22%5D&label=pi%20SDK&color=6E56CF" alt="pi SDK"></a>
</p>

[Pi](https://pi.dev) is quick and does what it is told. These extensions make it ask before it acts, ask you before it guesses, show what it is doing without making the screen jump, and bill the plan you already pay for.

```bash
pi install npm:@adeildo/pi-harness
```

They install on top of Pi as packages. There is no fork, and `pi remove` puts Pi back the way it was.

<!-- docs:ask-permission/preview -->

<p align="center">
  <img src="https://raw.githubusercontent.com/felipeadeildo/pi-harness/main/packages/ask-permission/assets/preview.png" alt="The permission dialog for npm install, with the reason it asks, the three answers, and a note on no: use pnpm instead." width="860">
  <br>
  <em>No, with a note the model reads: use pnpm instead.</em>
</p>

<!-- /docs -->

## What you get

| Piece                                 | In one line                                                                                                                              |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| [Permission](packages/ask-permission) | Pi asks before a tool call runs. Say yes, always yes or no, with a note the model reads. A judge model answers the routine calls for you |
| [Questions](packages/ask-questions)   | The model stops guessing and asks, with options, a live preview of each, a note on any of them and a row for your own answer             |
| [Look](packages/look)                 | A start card, a framed editor that carries the branch, the model and the context, and numbers that change without moving the screen      |
| [Providers](packages/providers)       | Anthropic requests billed to your Claude plan, and several accounts per provider with a switch to the next one when a limit hits         |

<!-- docs:look/preview -->

<p align="center">
  <img src="https://raw.githubusercontent.com/felipeadeildo/pi-harness/main/packages/look/assets/preview.png" alt="Pi with the look: the start card, then the strip with the stopwatch and the last call, the framed editor with the branch, the model and the context, and below it the cost, the tokens, the cache and the average speeds." width="860">
  <br>
  <em>The start card, then a prompt halfway through its answer.</em>
</p>

<!-- /docs -->

## Use one piece, or all of them

`@adeildo/pi-harness` brings every piece, and `pi config` turns any of them off. Each piece is also a package of its own: `pi install npm:@adeildo/pi-look` brings the look and nothing else. `Alt+S` opens the settings of whatever is installed.

## What to expect

- **Visible decisions.** Whatever answers in your place, the judge included, shows what it decided and can be undone.
- **No fork.** Pi stays Pi, and nothing leaves your machine unless you ask.
- **Your theme.** Every colour is a token of the theme you run.

## Where to read next

| You want to                     | Read                                                 |
| ------------------------------- | ---------------------------------------------------- |
| Use a piece                     | The page of the piece, linked in the table above     |
| Look up a setting or a key      | `docs/reference.md` in the permission and look pages |
| Know what is planned            | [ROADMAP.md](ROADMAP.md)                             |
| Know what changed               | [CHANGELOG.md](CHANGELOG.md)                         |
| Build a piece, or send a change | [CONTRIBUTING.md](CONTRIBUTING.md)                   |

## License

[MIT](LICENSE) © adeildo
