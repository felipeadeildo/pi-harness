<!--
Start the body with your agent's name in brackets, `[quokka]`, and the slice it lands: every session
uses the operator's GitHub account, so the name in the body is the only thing that says whose pull
request this is. A bot's pull request (the release, the Claude Code report) keeps its own body and
ignores this list.
-->

## What this lands

- [ ] The slice's line in `docs/remote-plan.md` is ticked, or the next pull request says why it is not
- [ ] `Closes #N` for each issue it closes
- [ ] `bun run verify` on the head, in a worktree of its own: `bun install --frozen-lockfile --ignore-scripts`
- [ ] The footer, `<p align="right"><sub><model> (<effort> effort) [<name>] @ adeildo's pi</sub></p>`

The rules behind these are in [`CONTRIBUTING.md`](../CONTRIBUTING.md) and
[`docs/remote-plan.md`](../docs/remote-plan.md); this list is only the part that gets forgotten
at the moment a pull request opens.

## What was wrong, what changes, and how to see it

One paragraph each: what was broken or missing, what this does about it, and the command or the run
that shows it working.
