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
  ask-permission/   # pi-ask-permission, published
  kit/              # @adeildo/pi-kit: app builder, feature scope, settings, events, contracts
  providers/        # @adeildo/pi-providers: subscription billing
```

Tooling lives at the root: one `tsconfig.json`, one oxlint and oxfmt config, one lockfile. The pi SDK versions are pinned in the root `package.json`, which is what the SDK compat workflow bumps. Packages declare the pi SDK as `peerDependencies` with `"*"`.

Internal dependencies use a plain version range, not `workspace:*`, because `npm publish` does not rewrite the workspace protocol. Bun still links the local package.

Each package has its own README and CONTRIBUTING with the parts that are only about it.

## Writing a feature

Build it with `defineFeature` and `createApp` from `@adeildo/pi-kit`, even when it's the only feature in its package. The harness mounts the same feature object, so a feature written this way works in both places without changes. The [kit README](packages/kit/README.md) covers the API. The rules:

- `setup` only registers. Anything that lasts starts in `scope.onSessionStart` and stops in `scope.onShutdown`.
- The scope is the extension API plus the app's services, and `scope.on` and `scope.registerCommand` come with the feature's name on every error.
- Declare a setting next to the feature that reads it. Only settings that are safe to take from a cloned repository get `project: true`.
- A feature never imports another feature's state. Anything that crosses features is an event in `packages/kit/src/contracts/` with a plain JSON payload.
- Every rule of the feature gets a test that fails when the rule breaks. `@adeildo/pi-kit/testing` fakes pi for that.

## Commit and release

Commits follow [Conventional Commits](https://www.conventionalcommits.org), scoped by package when they touch one (`feat(providers): ...`). [release-please](https://github.com/googleapis/release-please) runs in manifest mode: `release-please-config.json` lists the packages that release, `.release-please-manifest.json` holds their versions, and one release PR carries every bump and changelog. Merging it tags each release as `<package>-v<version>`, and the same workflow publishes to npm.

Auth is [trusted publishing](https://docs.npmjs.com/trusted-publishers/) over OIDC, so there is no `NPM_TOKEN` secret.

```bash
bun run smoke        # pack every package, install it outside the repo, load it
bun run publish:dry  # what a publish would do, without publishing
bun run trust        # point npm's trusted publisher at release.yml, per package
```

A trusted publisher can only be added to a package that already exists, so a new package goes out like this:

1. `npm publish --access public` by hand, from the package folder.
2. `bun run trust --only <package>`.
3. Add it to `release-please-config.json` and `.release-please-manifest.json`.
