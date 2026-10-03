# Contributing

## Setup

This package lives in the [pi-harness](https://github.com/felipeadeildo/pi-harness) monorepo. Setup, scripts, hooks and releases are shared and described in the [root CONTRIBUTING.md](../../CONTRIBUTING.md). Run every command from the repository root.

To run only this package's tests:

```bash
bun test ./packages/ask-permission
```

## Layout

```text
src/
  index.ts      # wiring only
  pi/           # pi boundary: events, commands, screen, session
  core/         # policy and judging, no pi and no TUI
    config/     # schema, decode, store, patterns
    judge/      # pipeline, compose, request, policy, the classifier
  ui/           # the permission question for the questions dialog, the host selector, the judge entry
  util/         # decoders and primitives
```

`core/` never imports `pi/` or `ui/`. The permission pipeline is in `pi/events.ts`, the judging pipeline in `core/judge`.

Untrusted input (config, grants, model answers) goes through a decoder, which returns a value or a list of problems and never throws.

The strings the package writes keep the old name: the `pi-ask-permission:judge` entry, the `pi-ask-permission:decided` event, the `pi-ask-permission:mode` status and the config folder. Old sessions read them on resume, so they never change.

## Imports

Use `#core`, `#ui`, `#pi`, `#util`, and `#identity`, declared in `package.json` `imports`. They resolve in tsc, Bun, and pi's jiti loader, so moving a file does not rewrite relative paths. tsconfig `paths` only works while pi runs from source, so it is not used.

## Adding a config key

1. Add the type and the default in `core/config/schema.ts`.
2. Declare the leaf in `core/config/settings.ts`, with the decoder and the row it shows on the settings screen. A missing key takes the default, and an invalid one is ignored with a warning.
3. Read it in `readConfig` and write it in `toEntries`, so saving the settings keeps it.
4. Add a test in `test/config.test.ts`. A round trip through `writeConfig` and `readConfig` is what proves the mapping.
