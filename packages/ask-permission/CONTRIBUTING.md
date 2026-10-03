How this package is built, and what a change to it touches. It lives in the [pi-harness](https://github.com/felipeadeildo/pi-harness) monorepo: setup, hooks, the docs and the release are shared and described in the [root CONTRIBUTING.md](../../CONTRIBUTING.md). Run every command from the repository root.

```bash
bun test ./packages/ask-permission   # this package's tests on their own
```

## Layout

```text
src/
  index.ts      # wiring only
  pi/           # pi boundary: events, commands, screen, session
  core/         # policy and judging, no pi and no TUI
    config/     # schema, decode, store, patterns
    judge/      # pipeline, compose, request, policy, the classifier
  ui/           # the permission ask for the questions dialog, the host selector, the judge entry
  util/         # decoders and primitives
```

`core/` never imports `pi/` or `ui/`, so the policy can be read and tested without a terminal. The permission pipeline is `pi/events.ts` and the judging pipeline is `core/judge/`.

Untrusted input (the settings file, the grants, an answer from a model) goes through a decoder, which returns a value or a list of problems and never throws.

The strings this package writes keep the old package name: the `pi-ask-permission:judge` entry, the `pi-ask-permission:decided` event, the `pi-ask-permission:mode` status and the settings folder. Old sessions read them on resume, so they never change.

## Imports

Use `#core`, `#ui`, `#pi`, `#util` and `#identity`, declared in `package.json` `imports`. They resolve in tsc, in Bun and in pi's jiti loader, so moving a file does not rewrite relative paths. The tsconfig `paths` only works while pi runs from source, so it is not used here.

## Adding a setting

1. Add the type and the default in `core/config/schema.ts`.
2. Declare the leaf in `core/config/settings.ts`, with its decoder and the row it shows on the settings screen. A missing key takes the default, and one that does not decode is ignored with a warning.
3. Read it in `readConfig` and write it in `toEntries`, so saving the settings keeps it.
4. Add a test in `test/config.test.ts`. A round trip through `writeConfig` and `readConfig` is what proves the mapping.

A setting that decides what runs belongs to the policy and never to the judge alone, and one that is safe to take from a cloned repository is the only kind that gets `project: true`.

## What to test

The judging pipeline is tested against a stub backend, so a verdict and the reason it produces are checked without a model. The classifier itself is tested with a fake registry, and the dialog with a scripted answerer, which is what lets `pi/events.ts` be tested end to end without a terminal.
