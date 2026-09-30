<h1 align="center">pi-harness</h1>

<p align="center">
  <a href="https://github.com/felipeadeildo/pi-harness/actions/workflows/ci.yml"><img src="https://github.com/felipeadeildo/pi-harness/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="license"></a>
  <a href="https://pi.dev"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Ffelipeadeildo%2Fpi-harness%2Fmain%2Fpackage.json&query=%24.devDependencies%5B%22%40earendil-works%2Fpi-coding-agent%22%5D&label=pi%20SDK&color=6E56CF" alt="pi SDK"></a>
</p>

The extensions I run [Pi](https://pi.dev) with, in one repository. Pi stays Pi. Everything here installs on top of it as a package, and each package works on its own.

## Packages

| Package                                                 | What it does                                                                         | Status                                                                                                                      |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| [`@adeildo/pi-ask-permission`](packages/ask-permission) | Asks before a tool call runs, with a judge model for the easy ones                   | [![npm](https://img.shields.io/npm/v/@adeildo/pi-ask-permission)](https://www.npmjs.com/package/@adeildo/pi-ask-permission) |
| [`@adeildo/pi-harness`](packages/harness)               | Everything else: the look, providers, and what comes next, one extension per feature | not published yet                                                                                                           |
| [`@adeildo/pi-kit`](packages/kit)                       | The app builder, settings and event bus the other packages share                     | not published yet                                                                                                           |

Two packages ship. The permission dialog makes sense on its own, so it has its own. Every other feature lives in the harness, and `pi config` turns any of them off. The kit is the base under both.

## How the packages fit

Every feature is built with `@adeildo/pi-kit`:

```ts
export default (pi: ExtensionAPI) => createApp(pi).use(subscription).build();
```

Every feature reads the same settings file. Features that need each other talk over typed events on `pi.events`, never through each other's state, so a feature can move out of the harness into a package of its own without changing.

## License

[MIT](LICENSE) © Felipe Adeildo
