<h1 align="center">pi-harness</h1>

<p align="center">
  <a href="https://github.com/felipeadeildo/pi-harness/actions/workflows/ci.yml"><img src="https://github.com/felipeadeildo/pi-harness/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://www.npmjs.com/package/@adeildo/pi-harness"><img src="https://img.shields.io/npm/v/@adeildo/pi-harness" alt="npm"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="license"></a>
  <a href="https://pi.dev"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Ffelipeadeildo%2Fpi-harness%2Fmain%2Fpackage.json&query=%24.devDependencies%5B%22%40earendil-works%2Fpi-coding-agent%22%5D&label=pi%20SDK&color=6E56CF" alt="pi SDK"></a>
</p>

The extensions adeildo runs [Pi](https://pi.dev) with. They install on top of Pi as packages, so there is no fork, and `pi remove` puts Pi back the way it was.

```bash
pi install npm:@adeildo/pi-harness
```

<p align="center">
  <img src="https://raw.githubusercontent.com/felipeadeildo/pi-harness/main/packages/look/assets/preview.png" alt="Pi with the look: the start card with the model, the folder, the branch and the keys, and below it the framed editor with the branch and folder in its top border and the model and context in its bottom border." width="860">
</p>

## What comes in it

| Piece                                 | What it does                                                                                                                                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Permission](packages/ask-permission) | Asks before a tool call runs. Answer yes, always yes or deny, with a note the model reads. A judge model can answer the routine calls for you                                                     |
| [Look](packages/look)                 | The start card, a framed editor with the branch, the model and the context in its borders, the time and speed of each answer, and the session's cost. Only theme colours                          |
| [Providers](packages/providers)       | Bills Anthropic OAuth requests to the Claude Pro or Max plan instead of extra usage. Holds several accounts per provider, pinned per session, and offers the next account when one hits its limit |
| [Questions](packages/ask-questions)   | The model asks instead of guessing, with options, a preview of each, a note on any of them, and your own answer                                                                                   |

`Alt+S` opens the settings of every piece. Each piece is its own extension, so `pi config` turns one off. Each is also a package of its own, for when you want only that one: `pi install npm:@adeildo/pi-look` brings the look and nothing else. Every piece's page has its install line.

All packages share one version. A release is one tag, one entry in [CHANGELOG.md](CHANGELOG.md), and one publish of every package from CI, with npm provenance.

## What comes next

The judge asking through the same dialog as the questions, the model a virtual model routed to shown in the footer, usage per plan and per project, and sessions that name themselves and talk to each other. The order and the reasons are in [ROADMAP.md](ROADMAP.md).

## Contributing

[CONTRIBUTING.md](CONTRIBUTING.md) covers the setup, how a piece is written on [`@adeildo/pi-kit`](packages/kit), and how a release goes out.

## License

[MIT](LICENSE) © adeildo
