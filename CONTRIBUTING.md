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
  kit/              # @adeildo/pi-kit: app builder, settings, events
  providers/        # @adeildo/pi-providers: subscription billing
```

Tooling lives at the root: one `tsconfig.json`, one oxlint and oxfmt config, one lockfile. The pi SDK versions are pinned in the root `package.json`, which is what the SDK compat workflow bumps. Packages declare the pi SDK as `peerDependencies` with `"*"`.

Internal dependencies use a plain version range, not `workspace:*`, because `npm publish` does not rewrite the workspace protocol. Bun still links the local package.

Each package has its own README and CONTRIBUTING with the parts that are only about it.

## Writing a feature

Build it with `createApp` from `@adeildo/pi-kit`, even when it is the only feature of its package. The builder applies the rules from pi's extension docs: nothing starts in the factory, long-lived work starts in `session_start`, cleanup runs once on `session_shutdown`, and a feature that fails to set up turns into a warning instead of taking the others down.

Settings are declared next to the feature with `setting()` and read with `handle.get(app)`. Features that need each other go through `defineEvent()`, never a direct import of another feature's state, so they keep working when installed apart.

## Commit and release

Commits follow [Conventional Commits](https://www.conventionalcommits.org), scoped by package when they touch one (`feat(providers): ...`). [release-please](https://github.com/googleapis/release-please) runs in manifest mode: `release-please-config.json` lists the packages that release, `.release-please-manifest.json` holds their versions, and one release PR carries every bump and changelog. Merging it tags each release as `<package>-v<version>`, and the same workflow publishes to npm.

Auth is [trusted publishing](https://docs.npmjs.com/trusted-publishers/) over OIDC, so there is no `NPM_TOKEN` secret. A trusted publisher can only be added to a package that already exists, so a new package goes out like this:

1. `npm publish --access public` by hand, from the package folder.
2. On npmjs.com, add a trusted publisher for `felipeadeildo/pi-harness` and `release.yml`.
3. Add the package to `release-please-config.json` and `.release-please-manifest.json`.
