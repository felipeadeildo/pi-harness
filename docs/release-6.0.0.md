# 6.0.0

What this release adds is a way to reach every session of every machine of yours from a phone, over
your tailnet, and agents that talk across machines. What it asks of anyone who wrote against 5.x is a
set of renamed shapes and two changed defaults.

Draft notes for the release pull request. The pending section of `CHANGELOG.md` is rebuilt on every
push to `main`, so this file is where the writing happens and the merge is where it is pasted.

## From your phone

- **Your sessions, in a browser.** The first pi on a machine starts a daemon, and `/remote` or
  `pi-remote open` opens the page: it lists what is open, shows the transcript as it streams, and takes
  a prompt. The page is made for a phone's screen first, and the daemon serves it.
- **Every machine of yours, from one address.** On a machine in a Tailscale tailnet the daemon also
  listens on its tailnet address, and a phone or a computer of yours opens it with no link: the daemon
  asks `tailscale whois` who the device belongs to. The daemons of your machines find each other the
  same way, with nothing paired, so the list holds the sessions of all of them and any of them opens
  through the address you used. Without Tailscale, a phone reaches a daemon through a tunnel such as
  `ssh -L 7878:127.0.0.1:7878`.
- **Agents talk across machines.** The daemons copy who is open on each machine and the logs of the
  shared rooms, so `Alt+G` lists the agents on your other machines and a room can hold them.
- **A session lives as long as its pi.** Closing the terminal ends it. Sessions with no terminal,
  notifications and HTTPS through `tailscale serve` are not built; `docs/remote.md` says what is.
- **Questions and dialogs answer from there.** A permission gate or a question from the model reaches
  the browser, and the answer reaches the terminal, marked with where it came from. A session with no
  terminal sends its questions to the clients instead of a dialog nobody can see.
- **`/` commands from the browser.** The list is the one the session offers, so a command that appears in
  the terminal appears there, and one that is not offered is refused with a reason.
- **Rooms and the board.** A session can work beside other agents, in a room one folder can hold, and a
  board of deliverables is written by the agent and read by everyone in the room. The `board` tool
  shows the open cards each other session has, under the name of the session that wrote them.
- **The cost, in the live state.** A session's spending is part of what a client reads while the
  session runs, so the browser shows the number the terminal shows.

## In the terminal

- **Questions above the editor.** A question from the model opens where you are typing, so answering it
  does not take the transcript away.
- **Room modes in `m`.** A session is in its room, listening to it, or out of it, and the mode is
  something you set rather than a state you discover.
- **The board on `Alt+T`.** The deliverables of a session, and who is blocked on whom, in a panel.

## What 6.0.0 asks of you

All but two of these are renames: the shape keeps its meaning and changes the word for it. The last
two rows change what happens.

| 5.x                                            | 6.0.0                                                                   |
| ---------------------------------------------- | ----------------------------------------------------------------------- |
| `facts`, `FactMap`, `isFactType`, `FACT_TYPES` | `state changes`, `StateChangeMap`, `isStateChangeType`, `STATE_CHANGES` |
| `applyEvent`                                   | `applyChange`                                                           |
| `SessionSnapshot`, `isSnapshot`                | `SessionSummary`, `isSummary`                                           |
| `SnapshotEvent`                                | `Opening`                                                               |
| `GET /sessions/:machine/:id/snapshot`          | `GET /sessions/:machine/:id/opening`                                    |
| `SessionSource.snapshot()`                     | `SessionSource.open()`                                                  |
| `SourceItem` of kind `"snapshot"`              | kind `"summary"`                                                        |
| `mode.set` offered to every session            | offered only when the session reports `permissions.serves`              |
| the harness's `/name`, `session.renamed`       | gone: a session's handle never changes, and pi's own `/name` names it   |

Two defaults change, and both are worth checking against your own setup:

- **The client port is a setting**, not a constant, so a machine that already uses the old one can move.
- **The daemon speaks WebSocket through `ws`**, bundled into `dist/daemon.js`, with a liveness ping
  every ten seconds. Nothing to install, and a peer that misses a beat is gone within twenty.

## The tasks are gone, and the board takes their place

In 5.x a small model kept the session's tasks from your words and the agent's work. In 6.0.0 the agent
keeps a board with the `board` tool instead: cards it can be asked about, in `todo`, `doing`, `review`
and `done`, each blocked on you, on another agent or on something outside, with the reason. No side
model runs for it, so it costs nothing per turn.

Everything that read the tasks reads the board now: the compaction summary ("Where the session
stands"), the look's strip, the peers' room and the bids, and the browser. Nothing writes a session
title any more. A session is known by its handle, the word drawn when it opens, which `@` mentions
reach and which never changes, and by the name you give it with pi's own `/name` or from the browser.
The harness's `/name`, which changed the handle, is gone: pi 1.4 has its own, which wins in the
terminal.

| 5.x                                                          | 6.0.0                                                           |
| ------------------------------------------------------------ | --------------------------------------------------------------- |
| `packages/tasks`, the tasks feature and its model            | the kit's board, and the `Alt+T` panel in `@adeildo/pi-harness` |
| `Alt+S` › Tasks, and the `tasks` settings                    | gone; the board's limits are fixed, 3 in progress and 15 open   |
| feature id `tasks`                                           | `names`, `board` and `board-panel`                              |
| `TASKS`, `SessionTasks`, `describeTasks`, `tasksFromEntries` | `BOARD`, `Board`, `describeBoard`, `boardOf`                    |
| `tasks.changed` and `tasks.board` in the log                 | `board.changed`, and the board's own `pi-board:op` entries      |
| `SessionState.tasks` on the wire                             | `SessionState.board`                                            |
| the look's `tasks` segment                                   | `board`                                                         |
| a title on `session.named`, on a peer and in presence        | the handle only                                                 |

Upgrade the daemon and the clients together. The shape of `SessionState` changed, and a 5.x client
does not know `board.changed`, so a 5.x client reading a 6.0.0 daemon shows no board.

`@adeildo/pi-board`, which was the tasks' package, is no longer published: install `@adeildo/pi-harness`,
which carries the board and its panel.

A session written with 5.x opens as it was. Its tasks' paid model calls still count in its cost, and
it keeps the handle the tasks gave it.
