# @adeildo/pi-harness

The extensions I run [Pi](https://pi.dev) with, as one package. Each feature is its own extension in the package manifest, so `pi config` turns one off without touching the rest.

| Feature                        | What it does                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------------- |
| [Look](docs/look.md)           | The start card, a framed editor, the answer strip and the footer, painted only with the theme's colours |
| [Providers](docs/providers.md) | Bills Anthropic OAuth requests to the Claude Pro or Max plan instead of extra usage                     |

The permission dialog is its own package, [`@adeildo/pi-ask-permission`](../ask-permission), because it makes sense without the rest.

## Install

```bash
pi install npm:@adeildo/pi-harness
```

## Settings

Every feature reads `~/.pi/agent/extensions/pi-harness/settings.json`, and `.pi/extensions/pi-harness/settings.json` in a trusted project for the settings marked _project_. Each feature's page lists its own.

## License

[MIT](LICENSE)
