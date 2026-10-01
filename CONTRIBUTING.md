# Contributing

## Setup

Requires [Bun](https://bun.sh). `bun install` links the workspace packages and installs the Lefthook hooks.

```bash
bun run check      # tsc --noEmit over every package
bun run lint       # oxlint
bun run fmt        # oxfmt (writes)
bun run test       # bun test
bun run verify     # all of the above
```

Lefthook formats and lints staged files on commit, type-checks the repository, and runs the full verify before a push.

## Layout

```text
packages/
  ask-permission/   # @adeildo/pi-ask-permission: the permission dialog and the judge
  look/             # @adeildo/pi-look: start card, framed editor, footer
  providers/        # @adeildo/pi-providers: subscription billing and accounts
  ask-questions/    # @adeildo/pi-ask-questions: the ask_questions tool and its dialog
  harness/          # @adeildo/pi-harness: every piece above, one extension each
  kit/              # @adeildo/pi-kit: app builder, feature scope, settings, events
```

Tooling lives at the root: one `tsconfig.json`, one oxlint and oxfmt config, one lockfile. The pi SDK versions are pinned in the root `package.json`, which is what the SDK compat workflow bumps. Packages declare the pi SDK as `peerDependencies` with `"*"`.

Internal dependencies use `workspace:*`. Publishing goes through `bun pm pack`, which writes the real version into the tarball, and `bun run smoke` fails if a `workspace:` range is left in one.

Every piece is a package of its own, so it installs alone, and the harness brings them all. A new piece is a folder under `packages/` whose `src/index.ts` exports its feature and a default extension that mounts it. The harness then gets a dependency on it and a file in `packages/harness/src/` that mounts the same feature, listed in its `pi.extensions`.

Each package has its own README. `ask-permission` also has a CONTRIBUTING with the parts that are only about it.

## Writing a feature

Build it with `defineFeature` and `createApp` from `@adeildo/pi-kit`. The harness mounts the same feature object as the standalone package, so a feature written this way works in both places without changes, and the kit keeps it from running twice when both are installed. The [kit README](packages/kit/README.md) covers the API. The rules:

- `setup` only registers. Anything that lasts starts in `scope.onSessionStart` and stops in `scope.onShutdown`.
- The scope is the extension API plus the app's services, and `scope.on` and `scope.registerCommand` come with the feature's name on every error.
- Declare a setting next to the feature that reads it. Only settings that are safe to take from a cloned repository get `project: true`.
- A feature never imports another feature's state. Anything that crosses features is an event in `packages/kit/src/contracts/` with a plain JSON payload.
- Every rule of the feature gets a test that fails when the rule breaks. `@adeildo/pi-kit/testing` fakes pi for that.

## Commit and release

Commits follow [Conventional Commits](https://www.conventionalcommits.org), scoped by feature (`feat(look): ...`, `fix(ask-permission): ...`). Every package ships at one version, the way pi does. [release-please](https://github.com/googleapis/release-please) has one component, the repository root. `.release-please-manifest.json` holds the version, and `extra-files` in `release-please-config.json` writes it into each package's `package.json`. One release PR carries the bump and the root `CHANGELOG.md`. Merging it tags `v<version>`, writes one GitHub release, and the same workflow publishes every package to npm.

Auth is [trusted publishing](https://docs.npmjs.com/trusted-publishers/) over OIDC, so there is no `NPM_TOKEN` secret.

```bash
bun run smoke        # pack every package, install it outside the repo, load it
bun run publish:dry  # what a publish would do, without publishing
bun run trust        # point npm's trusted publisher at release.yml, per package
```

A trusted publisher can only be added to a package that already exists, so a new package goes out like this:

1. Set its `version` to the repository's and add its `package.json` to `extra-files` in `release-please-config.json`.
2. `bun run publish` by hand, which publishes what is missing and asks for 2FA.
3. `bun run trust --only <package>`.
