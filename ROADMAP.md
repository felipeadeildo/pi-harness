# Roadmap

What I plan to build in this repository. [IDEA.md](IDEA.md) is where the ideas were born, with the reasoning and the data behind them. It was written before pi 0.99, so parts of it are history now. This file is the plan, and it wins when the two disagree.

Every item has to pass the test from IDEA.md. Why does it exist instead of me doing it by hand? If the answer is that it's more elegant, it goes. If it's something I do ten times a day, it stays.

Status is one of `done`, `next`, `planned`, `later`, `drop`. "Replaces" names the third-party package I run today that the item takes over. Until it lands, that package stays installed.

## Rules that hold for every item

- Pi first. Before an item starts, check that pi doesn't ship it already. Every pi release gets a pass over this file, logged under [Pi releases](#pi-releases).
- Every feature is built on `@adeildo/pi-kit`.
- Features only talk through contracts in `packages/kit/src/contracts/`. Payloads are plain JSON, so a remote control or a web UI can forward any of them without knowing what they mean.
- Anything that decides for me is visible and reversible.
- Nothing leaves the machine unless I ask. That covers traces, usage and memory.
- Pi stays Pi. No fork.

## What ships

One install brings everything: `@adeildo/pi-harness`. Every piece is also a package of its own, for whoever wants only that one, and all of them share one version.

| Package                      | What it is                                             |
| ---------------------------- | ------------------------------------------------------ |
| `@adeildo/pi-harness`        | Every piece below, one extension each                  |
| `@adeildo/pi-ask-permission` | The permission dialog and the judge                    |
| `@adeildo/pi-look`           | The start card, the framed editor and the footer       |
| `@adeildo/pi-providers`      | Subscription billing, and the account work to come     |
| `@adeildo/pi-ask-questions`  | The question tool and its dialog                       |
| `@adeildo/pi-kit`            | The library under all of them, and the settings screen |

A new piece is a package under `packages/`, and the harness mounts the same feature object from a file of its own. With a piece installed twice, standalone and in the harness, the kit's claim on `pi.events` lets the first copy run it and keeps the other off.

| Item                              | Status  | Notes                                                                                                                                                                  |
| --------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Monorepo, bun workspaces, the kit | done    | App, feature scope, settings, events. `pi-ask-permission` moved in with its history                                                                                    |
| Release pipeline                  | done    | See [Releases](#releases)                                                                                                                                              |
| One package per piece             | done    | `look` and `providers` are packages, and the harness depends on every piece and mounts each as its own extension                                                       |
| Publish look and providers        | done    | On npm since 4.1.0, published by `release.yml` with provenance                                                                                                         |
| First publish                     | done    | 4.0.0 of the kit, permission and the harness is on npm, with trusted publishing pointed at `release.yml`. `pi-ask-permission` is deprecated with the command to switch |
| `/harness setup`                  | planned | Applies the pi settings a package can't set by itself: `tuiMode`, `outputPad`, the extra usage warning. Tools go through `defaultTools` with `+name` now               |
| Settings screen                   | done    | `Alt+S` or `/harness`, a tab per piece. Replaces `/perm` and `/look`. Pi's own settings stay in `/settings`                                                            |

## Permission. `@adeildo/pi-ask-permission`

| Item                   | Status  | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| On the kit             | done    | `contracts/permission`, `ui/` and the per-session state still move into the kit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| MCP and codemode calls | done    | Calls a codemode script makes reach the gate with `parentToolCallId`, and every call inside a script is decided on its own. `codemode` and `tool_search` themselves run without asking, because asking about the wrapper asks twice for one thing. A server tool (`mcp__<server>__<tool>`) follows the policy of its server, on the Permission tab: `ask` every call, `hints` (the default, where a call the server declares read-only runs and the rest follows the mode), `allow` or `deny`. A deny outranks the mode, `full` included. Any tool that declares `readOnlyHint` is let through by the read-only layer, the resource tools of MCP among them. The dialog names the server, says what it declares, and says when a script issued the call, and the judge reads both as data. Left: the servers of my own that declare nothing list every tool as a writer, so `dorothy/mcp/tools/*.py` wants `annotations` one day |
| Judge in two tiers     | planned | The first tier is a classifier through `ctx.modelRegistry.classify()`, Jev or a local llama.cpp model, so the easy cases cost almost nothing and a local one never leaves the machine. The expensive model only near the threshold or above the risk ceiling                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Intent signal          | done    | The judge reads `intent` as context, never as a permission. Today it is the last message I typed (`currentIntent`); once sessions publish their goal (see [Sessions](#sessions)), that source replaces it and the judge does not change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

## Questions

| Item                       | Status | Replaces                 | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------- | ------ | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Port the question tool     | done   | `rpiv-ask-user-question` | `@adeildo/pi-ask-questions`. The schema, validation, preview layout and RPC path are ported, and the dialog is new, built like the permission dialog: drawn in the flow of the screen so it scrolls instead of being cut off, a note on any option (picked or not) instead of per question, no note for the whole questionnaire, no fold key, English only, settings on `Alt+S`. Left: `ctrl+g` to edit the typed answer in the external editor |
| Answers as session entries | done   |                          | The structured answer is the tool result's `details`: stored with the call, following the branch. What reads it (the policy that learns, structured compaction) is still to come                                                                                                                                                                                                                                                                |
| One channel with the judge | done   |                          | The permission ask goes through the questions dialog over the kit's `ask` contract, so both are one dialog with the same keys. `always yes` became two more questions (which calls, for how long), and a typed answer blocks the call with the text as the reason                                                                                                                                                                               |

## Accounts

| Item            | Status | Replaces                                | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------- | ------ | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Subscription    | done   | `pi-use-anthropic-subscription`         | Recognizes the account by its OAuth token, not by the provider name                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Accounts        | done   | `pi-multiprovider`, `pi-hide-providers` | One provider id, many labelled credentials. The credential of the pi login is tagged as the first account, and another comes from running the provider's own login (`provider.auth.oauth.login`) and storing the returned `Credential`, so there is no OAuth of our own. The provider is re-registered with a wrapped `auth` that resolves the active account, so the model list stays single. The active account is a session entry, the way `mode` is, so resume restores who paid. The kit screen manages the accounts, `alt+a` cycles them, and `model_select` offers the account when the chosen provider has more than one. No supported filter for `/model`: `enabledModels` covers only startup and cycling, and an extension command cannot shadow a built-in, so hiding a provider waits on a catalog hook upstream. Everything else is in |
| Switch on limit | done   | `pi-multiprovider`                      | A quota or rate limit that arrives before any output moves to the next account of the provider. `accounts.onLimit` is `ask` (a dialog, with an always option that turns the policy into `switch`), `switch` (moves on its own), or `stop`. A busy server is not a limit, so it surfaces instead of switching                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Quota per plan  | next   |                                         | Read from each provider's API: Anthropic, Codex, Copilot and OpenRouter, from IDEA.md. Sign in with ChatGPT now lives on the `openai` provider and `openai-codex` is legacy, so the Codex quota reads whichever holds the token. It is a feature of its own because three things read it: the switch, the look and `/usage`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

## What I see. The look

| Item                    | Status | Replaces      | Notes                                                                                                                                                                                                                                                                                                                                            |
| ----------------------- | ------ | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Statusline              | done   | `pi-open-tui` | Segments go in named slots with a priority and a short form, and a status from any package can have a slot of its own (`status:<key>`), which is where the permission mode sits                                                                                                                                                                  |
| Header and editor frame | done   | `pi-open-tui` | The start card, a framed editor with four slots in its borders, a bar cursor, the answer strip with speeds both ways and time to first token, and a working line with the tail of the thinking or the command running                                                                                                                            |
| Show the routed model   | later  |               | With a virtual model, `ctx.model` is the selection (`auto`), and the model segment would read the physical model from the last assistant message instead. Nothing I run registers a virtual model: in 161 sessions up to 2026-10-01 the model I picked was always the one that answered. It comes back with the first router                     |
| Theme from the desktop  | drop   |               | Pi 0.99's `system` theme builds from the terminal's palette, and Ghostty already runs the matugen palette (`theme = dankcolors`). `src/desktop/`, `look.desktop*` and `/look theme` go once one test passes: pi asks the terminal for colors again only on a light/dark report (mode 2031), so a new wallpaper in the same mode may not reach it |

## Sessions

| Item                     | Status  | Replaces    | Notes                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------ | ------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Session naming           | planned |             | Names a session from its first turns. Small, and the look shows the result                                                                                                                                                                                                                                                                                                                                         |
| Session state            | planned |             | Goal, current task, plan, touched files, last summary. A snapshot per session, never an event log                                                                                                                                                                                                                                                                                                                  |
| Structured compaction    | planned |             | Goal, decisions, open questions and files, taken from the session state instead of prose                                                                                                                                                                                                                                                                                                                           |
| Compaction by classifier | later   |             | A classifier (Jev) judges which entries belong in the history, in place of one prose summary. The classifier becomes a contract in the kit, so the permission judge and compaction share one backend. Plugs into `session_before_compact`. Research: selection (keep or drop items) versus generation (rewrite), and the prompt cache lost when the prefix is rewritten, so it fires at a boundary, not every turn |
| Sessions talking         | planned |             | An inbox folder per session with one file per message, and `pi.events` inside one process. Nobody waits on anybody                                                                                                                                                                                                                                                                                                 |
| Memory                   | planned | `pi-memory` | Markdown as the source of truth, qmd as optional search, and a command to review and delete what was stored. Nothing gets recorded without me seeing it. A feature of the harness, and the session state and compaction write to it                                                                                                                                                                                |
| Mentions                 | later   |             | `#entry`, `@file` and session references expanded before the turn                                                                                                                                                                                                                                                                                                                                                  |

## Usage

| Item         | Status  | Notes                                                                                                                                                                                                                                                                                  |
| ------------ | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Usage ledger | planned | One local record per session, project, account and model, built from the session files with a cache. `/session` now lists cost per physical model, but only for the session it is in                                                                                                   |
| `/usage`     | planned | One screen with both sides: what the plan says is left (the quota, from the provider's API) next to what I spent (the ledger), per account, with the reset time. Dollars where the provider bills per token, percent where it bills per plan, because a subscription reports zero cost |

## Many agents

| Item           | Status | Replaces       | Notes                                                                                                                          |
| -------------- | ------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Subagents      | later  | `pi-subagents` | Children over `RpcClient`, with their permission dialogs forwarded to the parent. Keep upstream until a concrete need shows up |
| Model per task | later  |                | A virtual model, not a piece of my own. The choice shows in the look, which is the same work as "Show the routed model"        |

## The outside world

| Item                 | Status | Replaces        | Notes                                                                                                                      |
| -------------------- | ------ | --------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Web search and fetch | later  | `pi-web-access` | Route by kind of question: docs, code, news                                                                                |
| GitHub, Linear, CI   | later  |                 | CI is a watcher that emits events, not a command. Policy per repository                                                    |
| QA and browser       | later  |                 | Reuse a session I already signed into, and never see a password. Deterministic checks first, screenshots in the transcript |

`pi-web-access` runs past 30 thousand lines. It stays installed until a limit of its own actually costs me something.

## From anywhere

| Item          | Status | Notes                                                                                                                                                                                           |
| ------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Remote bridge | later  | Forwards `harness:*` contracts and pi's RPC dialogs over a socket reachable through Tailscale. Approve a call from the phone with the same policy and judge. Remote never runs with `auto` mode |
| Web UI        | later  | A page on top of the bridge showing sessions, their state, pending approvals and usage                                                                                                          |
| Voice         | later  | Local whisper, with the text pasted into the editor                                                                                                                                             |

With every feature speaking JSON contracts, the bridge forwards events and doesn't need to understand them.

## Pi releases

What each pi release took off the plan, or changed in it.

### 0.99 (2026-09-29)

- **MCP is built in**, with codemode, `tool_search`, OAuth and `/mcp`. The MCP item and `pi-mcp-adapter` leave the plan. What's left is permission, under "MCP and codemode calls".
- **The `system` theme is the default**, built from the terminal's palette. The desktop theme drops, after one test.
- **Virtual models** route every request to a physical model. Rotation and the model per task become virtual models instead of code of mine.
- **Classifier models**, Jev and any llama.cpp model. They are the first tier of the judge.
- **Sign in with ChatGPT** on the `openai` provider, and `openai-codex` is legacy. The Codex quota follows the token.
- **`pi config` has a Built-in section and filters every package's extensions**, and `defaultTools` takes `+name` and `-name`. Feature switches and part of `/harness setup` are pi's now.
- **Tool exposure, annotations and `ctx.executeTool()`**. Nested calls reach the gate, which is the permission item above.

## Parked

- A policy that learns from my denials. It needs the decision log and months of data first, and it only ever suggests.
- Review and anchored annotation. Needs the session state.
- A sandbox that decides where a command runs. That's a separate question from whether it may run.

## Out

- Semantic PR review. It's a product of its own and gets its own repository.
- A fork of pi, a plugin store, vector search in the first version of memory, a policy that changes by itself.
- Translations. English only.

## Open questions

1. Is the 5-hour window rolling or a block that starts at first use?
2. One memory file with sections, or separate global and project files?
3. How long a gap counts as a pause when I measure time worked?
4. For the browser, attach to my Chromium over CDP, or give the agent a profile I sign into once?
5. Do annotations live on the file line, on the transcript entry, or on both?

## Releases

Modeled on how oh-my-pi and pi itself release, because both solved the same problem: a monorepo where more than one package ships.

1. Work lands on `main` as one-line conventional commits, scoped by feature: `feat(look)`, `fix(ask-permission)`.
2. Every package ships at one version, the way pi does. release-please has one component, the repository root, and opens a release PR with the bump and the root `CHANGELOG.md`. `extra-files` writes the version into each package's `package.json`.
3. A job in `release.yml` refreshes `bun.lock` on that PR. Without it the tarballs would depend on the old kit, because `bun pm pack` takes a workspace dependency's version from the lockfile.
4. Merging the PR tags `v<version>` and writes one GitHub release. Every release publishes all three packages, even the ones that didn't change, and that is the price of one version.
5. The same run verifies, then runs `bun run smoke`, which packs every package, installs the tarballs outside the repository and loads them. A missing file in `files`, an unresolved `workspace:` range, a dependency on an old workspace version or one that only exists in the workspace fails there instead of on someone else's machine.
6. `scripts/publish.ts` publishes in dependency order (the kit, then each piece, then the harness), skips a version already on npm, and leaves the dependents of a failure alone. Trusted publishing over OIDC gives provenance and no stored token.

A package that doesn't exist on npm yet can't have a trusted publisher, so the first publish of each `@adeildo/` name is done by hand with 2FA, and `bun run trust` runs after it.

### Leaving the old name

`pi-ask-permission` 3.0.0 stays on npm and keeps working for whoever has it. Its last release changes nothing but its README, which points at the new name, and then `npm deprecate` says the same on every install. Pi finds a package by its npm name, so nobody moves on their own: they run `pi remove npm:pi-ask-permission` and `pi install npm:@adeildo/pi-ask-permission`.

Only the npm name changes. The strings the package writes keep saying `pi-ask-permission`: the judge card in the session files (`pi-ask-permission:judge`), the `pi-ask-permission:decided` event, the `pi-ask-permission:mode` status and the config folder. Renaming them would break every old session on resume, which is the bug IDEA.md already tells.

A new package needs three things before it can ship: the repository's version with its `package.json` in `extra-files`, a first publish by hand, and `bun run trust` to point its npm trusted publisher at `release.yml`.

Compared with oh-my-pi and pi, these are still missing, in the order I would take them:

- A preflight in the release path: refuse to release when `main` is behind, the tree is dirty, or the CI run for the commit is red.
- A local release dry run that installs the packed tarballs somewhere outside the repository and runs a real `pi` session against them.
