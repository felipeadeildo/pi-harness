# Roadmap

What I plan to build in this repository, in order. [IDEA.md](IDEA.md) is where the ideas were born, with the reasoning and the data behind them. This file is the condensed plan, and it wins when the two disagree.

Every item has to pass the test from IDEA.md. Why does it exist instead of me doing it by hand? If the answer is that it's more elegant, it goes. If it's something I do ten times a day, it stays.

Status is one of `done`, `next`, `planned`, `later`. "Replaces" names the third-party package I run today that the item takes over. Until it lands, that package stays installed.

## Rules that hold for every phase

- Every feature is built on `@adeildo/pi-kit` and works both inside the harness and as its own package.
- Features only talk through contracts in `packages/kit/src/contracts/`. Payloads are plain JSON, so a remote control or a web UI can forward any of them without knowing what they mean.
- Anything that decides for me is visible and reversible.
- Nothing leaves the machine unless I ask. That covers traces, usage and memory.
- Pi stays Pi. No fork.

## Phase 0. The base

| Item                                                    | Status | Notes                                                        |
| ------------------------------------------------------- | ------ | ------------------------------------------------------------ |
| Monorepo, bun workspaces                                | done   | `pi-ask-permission` moved with its history                   |
| `@adeildo/pi-kit`: app, feature scope, settings, events | done   | settings per project are opt-in, a feature can be turned off |
| `providers/subscription`                                | done   | replaces `pi-use-anthropic-subscription`                     |
| Release pipeline                                        | done   | see [Releases](#releases) below                              |

## Phase 1. Move what exists onto the kit

| Item                                        | Status  | Notes                                                                                                                                                       |
| ------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pi-ask-permission` on the kit              | done    | The app, the feature scope and the shared settings are in. `contracts/permission`, `ui/` and per-session state still move into the kit                      |
| Settings screen generated from the registry | planned | One `/harness` screen for every feature, with the switches from `features.<id>.enabled`                                                                     |
| `@adeildo/pi-harness`                       | planned | One install, one app, my defaults. `/harness setup` applies the pi settings a package can't set by itself (`tuiMode`, `outputPad`, the extra usage warning) |

## Phase 2. Providers

| Item                          | Status  | Replaces            | Notes                                                                                                                                                               |
| ----------------------------- | ------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hide providers                | planned | `pi-hide-providers` | `enabledModels` only covers startup and cycling, so this stays code                                                                                                 |
| Several accounts per provider | planned | `pi-multiprovider`  | A native `registerProvider` per account (`anthropic-work`), each with its own `/login`. Subscription already recognizes the account by its OAuth token, not by name |
| Rotation                      | planned | `pi-multiprovider`  | Switch accounts on a limit before any text reaches the screen, and keep a session on one account so the cache stays warm. Emits `providers:account-changed`         |
| Quota per plan                | planned |                     | Anthropic, Codex, Copilot and OpenRouter endpoints, from IDEA.md. Shared by rotation and the statusline                                                             |

## Phase 3. What I see

| Item                    | Status  | Replaces               | Notes                                                                                                                                                                                                                                        |
| ----------------------- | ------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Statusline              | done    | `pi-open-tui` (footer) | In `@adeildo/pi-look`. Segments go in named slots with a priority and a short form, and a status from any package can have a slot of its own (`status:<key>`), which is where the permission mode now sits                                   |
| Header and editor frame | done    | `pi-open-tui`          | In `@adeildo/pi-look`. The start card, a framed editor with four slots in its borders, a bar cursor, the answer strip with speeds both ways and time to first token, and a working line with the tail of the thinking or the command running |
| Session naming          | planned |                        | Names a session from its first turns. Small, and the footer shows the result                                                                                                                                                                 |
| Theme from the desktop  | done    |                        | In `@adeildo/pi-look`. The DMS palette becomes the pi theme `desktop` in `~/.pi/agent/themes/`, rewritten when the wallpaper changes. The look itself only uses theme tokens, so it follows any theme                                        |
| Usage ledger            | planned |                        | One local record of usage per session, project, account and model, built from the session files with a cache. The statusline windows, `/usage` and later the traces all read it                                                              |

Review: IDEA.md had usage per project, observability and the statusline's numbers as three pieces. They're one dataset, so they become one ledger with three readers.

## Phase 4. Memory and state

| Item                  | Status  | Replaces                 | Notes                                                                                                                                                   |
| --------------------- | ------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Session state         | planned |                          | Goal, current task, plan, touched files, last summary. A snapshot per session, never an event log                                                       |
| Structured compaction | planned |                          | Goal, decisions, open questions and files, taken from the session state instead of prose                                                                |
| Memory                | planned | `pi-memory`              | Markdown as the source of truth, qmd as optional search, and a command to review and delete what was stored. Nothing gets recorded without me seeing it |
| Questions             | planned | `rpiv-ask-user-question` | Adopt first. Record its answers as session entries through its public events. Write my own only when the judge needs to ask through the same channel    |
| Mentions              | later   |                          | `#entry`, `@file` and session references expanded before the turn                                                                                       |

Review: the judge regains its intent signal here, because it can compare a call against the goal the session publishes.

## Phase 5. Many agents

| Item             | Status | Replaces       | Notes                                                                                                                                                                                 |
| ---------------- | ------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Subagents        | later  | `pi-subagents` | Children over `RpcClient`, with their permission dialogs forwarded to the parent. Keep upstream until a concrete need shows up                                                        |
| Sessions talking | later  |                | An inbox folder per session with one file per message, and `pi.events` inside one process. Nobody waits on anybody                                                                    |
| Router           | later  |                | One piece for both jobs IDEA.md listed: the two-level judge (cheap model first, expensive one near the threshold) and picking a model per task. The choice shows up in the statusline |

## Phase 6. The outside world

| Item                 | Status | Replaces         | Notes                                                                                                                            |
| -------------------- | ------ | ---------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| MCP                  | later  | `pi-mcp-adapter` | One proxy tool, servers start on demand. Policy per server, a new server starts off, and the judge treats arguments as untrusted |
| Web search and fetch | later  | `pi-web-access`  | Route by kind of question: docs, code, news                                                                                      |
| GitHub, Linear, CI   | later  |                  | CI is a watcher that emits events, not a command. Policy per repository                                                          |
| QA and browser       | later  |                  | Reuse a session I already signed into, and never see a password. Deterministic checks first, screenshots in the transcript       |

Review: both upstream packages run past 30 thousand lines each. They stay installed until a limit of theirs actually costs me something.

## Phase 7. From anywhere

| Item          | Status | Notes                                                                                                                                                                                           |
| ------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Remote bridge | later  | Forwards `harness:*` contracts and pi's RPC dialogs over a socket reachable through Tailscale. Approve a call from the phone with the same policy and judge. Remote never runs with `auto` mode |
| Web UI        | later  | A page on top of the bridge showing sessions, their state, pending approvals and usage                                                                                                          |
| Voice         | later  | Local whisper, with the text pasted into the editor                                                                                                                                             |

Review: IDEA.md put remote access near the end, and it's still near the end. What changed is the cost. With every feature speaking JSON contracts, the bridge forwards events and doesn't need to understand them.

## Parked

- A policy that learns from my denials. It needs the decision log from phase 1 and months of data first, and it only ever suggests.
- Review and anchored annotation. Needs the session state from phase 4.
- A sandbox that decides where a command runs. That's a separate question from whether it may run.

## Out

- Semantic PR review. It's a product of its own and gets its own repository.
- A fork of pi, a plugin store, vector search in the first version of memory, a policy that changes by itself.
- Translations. English only.

## Open questions

Carried over from IDEA.md, minus the ones this file already answers.

1. Is the 5-hour window rolling or a block that starts at first use?
2. One memory file with sections, or separate global and project files?
3. How long a gap counts as a pause when I measure time worked?
4. For the browser, attach to my Chromium over CDP, or give the agent a profile I sign into once?
5. Do annotations live on the file line, on the transcript entry, or on both?

## Releases

Modeled on how oh-my-pi and pi itself release, because both solved the same problem: a monorepo where
more than one package ships.

1. Work lands on `main` as one-line conventional commits, scoped by package.
2. release-please reads `release-please-config.json` and `.release-please-manifest.json` and opens a
   single release PR with every version bump and changelog. Merging it tags each package as
   `<package>-v<version>`.
3. The same run verifies, then runs `bun run smoke`, which packs every package, installs the
   tarballs outside the repository and loads them. A missing file in `files`, an unresolved
   `workspace:` range or a dependency that only exists in the workspace fails there instead of on
   someone else's machine.
4. `scripts/publish.ts` publishes in dependency order, skips a version already on npm, and leaves
   the dependents of a failure alone. Trusted publishing over OIDC gives provenance and no stored
   token.

A new package needs three things before it can ship: `bun run trust` to point its npm trusted
publisher at `release.yml`, an entry in `release-please-config.json`, and one in
`.release-please-manifest.json`.

Compared with oh-my-pi and pi, these are still missing, in the order I would take them:

- Aggregate release notes: one release carrying every package's changelog section, instead of one
  release per package with its own.
- A preflight in the release path: refuse to release when `main` is behind, the tree is dirty, or
  the CI run for the commit is red.
- A local release dry run that installs the packed tarballs somewhere outside the repository and
  runs a real `pi` session against them.
