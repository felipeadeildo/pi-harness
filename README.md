<h1 align="center">pi-harness</h1>

<p align="center">
  <a href="https://github.com/felipeadeildo/pi-harness/actions/workflows/ci.yml"><img src="https://github.com/felipeadeildo/pi-harness/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="license"></a>
  <a href="https://pi.dev"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Ffelipeadeildo%2Fpi-harness%2Fmain%2Fpackage.json&query=%24.devDependencies%5B%22%40earendil-works%2Fpi-coding-agent%22%5D&label=pi%20SDK&color=6E56CF" alt="pi SDK"></a>
</p>

The extensions I run [Pi](https://pi.dev) with, in one repository. Pi stays Pi. Everything here installs on top of it as a package, and each package works on its own.

## Packages

| Package                                        | What it does                                                              | Status                                                                                                    |
| ---------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| [`pi-ask-permission`](packages/ask-permission) | Asks before a tool call runs, with a judge model for the easy ones        | [![npm](https://img.shields.io/npm/v/pi-ask-permission)](https://www.npmjs.com/package/pi-ask-permission) |
| [`@adeildo/pi-look`](packages/look)            | The start screen, a framed editor and the footer, in your theme's colours | not published yet                                                                                         |
| [`@adeildo/pi-providers`](packages/providers)  | Bills Anthropic OAuth requests to the Claude plan                         | not published yet                                                                                         |
| [`@adeildo/pi-kit`](packages/kit)              | The app builder, settings and event bus the other packages share          | not published yet                                                                                         |

A package stays private until I use it every day. `@adeildo/pi-harness`, which brings every package in with my defaults, comes once there is more than one to bring.

## How the packages fit

Every feature is built with `@adeildo/pi-kit`:

```ts
export default (pi: ExtensionAPI) => createApp(pi).use(subscription).build();
```

A standalone package is an app with its own features. The harness will be one app with all of them, so they share one settings file, one settings screen and one footer. Features that need each other talk over typed events on `pi.events`, which works the same whether they share an app or not.

## License

[MIT](LICENSE) © Felipe Adeildo
