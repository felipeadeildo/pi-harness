<!--
Start the body with your agent's name in brackets, `[quokka]`, and the slice it lands: every session
uses the operator's GitHub account, so the body and the branch name are what say whose pull request
this is. A bot's pull request (the release, the Claude Code report) keeps its own body and
ignores this list.
-->

## What this lands

- [ ] The slice's line in `docs/remote-plan.md` is ticked, or the next pull request says why it is not
- [ ] `Closes #N` for each issue it closes, when it closes one
- [ ] `bun run verify` on the head, in a worktree of its own: `bun install --frozen-lockfile --ignore-scripts`
- [ ] The footer, `<p align="right"><sub><model> (<effort> effort) [<name>] @ adeildo's pi</sub></p>`
- [ ] Agents are named `[name]` or as a plain word, never `@name`: on GitHub that handle is a real person

The rules behind these are in [`CONTRIBUTING.md`](https://github.com/felipeadeildo/pi-harness/blob/main/CONTRIBUTING.md) and
[`docs/remote-plan.md`](https://github.com/felipeadeildo/pi-harness/blob/main/docs/remote-plan.md); this list is only the part that gets forgotten
at the moment a pull request opens.

## What was wrong, what changes, and how to see it

One paragraph each: what was broken or missing, what this does about it, and the command or the run
that shows it working, followed by its output.
