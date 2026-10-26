# 6.0.0

What this release adds is a way to reach a session from a phone, a browser or another machine, and
what it asks of anyone who wrote against 5.x is a set of renamed shapes and two changed defaults.

Draft notes for the release pull request. The pending section of `CHANGELOG.md` is rebuilt on every
push to `main`, so this file is where the writing happens and the merge is where it is pasted.

## From the phone

- **Your sessions, in a browser and in an app.** `pi-remote` starts a daemon on the machine where a pi
  runs, and the app lists what is open, shows the transcript as it streams, and takes a prompt. The
  session keeps running when the terminal closes.
- **Questions and dialogs answer from there.** A permission gate or a question from the model reaches
  the phone, and the answer reaches the terminal, marked with where it came from. A session with no
  terminal sends its questions to the clients instead of a dialog nobody can see.
- **`/` commands from the phone.** The list is the one the session offers, so a command that appears in
  the terminal appears there, and one that is not offered is refused with a reason.
- **Rooms and the board.** A session can work beside other agents, in a room one folder can hold, and a
  board of deliverables is written by the agent and read by everyone in the room. The `board` tool
  shows the open cards each other session has, under the name of the session that wrote them.
- **The cost, in the live state.** A session's spending is part of what a client reads while the
  session runs, so a phone shows the number the terminal shows.

## In the terminal

- **Questions above the editor.** A question from the model opens where you are typing, so answering it
  does not take the transcript away.
- **Room modes in `m`.** A session is in its room, listening to it, or out of it, and the mode is
  something you set rather than a state you discover.
- **The board on `Alt+T`.** The deliverables of a session, and who is blocked on whom, in a panel.

## What 6.0.0 asks of you

All but one of these are renames: the shape keeps its meaning and changes the word for it. The last
row is not a rename, and it is the only one that changes what happens.

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
stands"), the look's strip, the peers' room and the bids, and the phone. Nothing writes a session
title any more. A session is its handle, and the name you give it with `/name` or from the phone.

| 5.x                                                          | 6.0.0                                                         |
| ------------------------------------------------------------ | ------------------------------------------------------------- |
| `packages/tasks`, the tasks feature and its model            | `packages/board`: the `Alt+T` panel over the kit's board      |
| `Alt+S` › Tasks, and the `tasks` settings                    | gone; the board's limits are fixed, 3 in progress and 15 open |
| feature id `tasks`                                           | `names`, `board` and `board-panel`                            |
| `TASKS`, `SessionTasks`, `describeTasks`, `tasksFromEntries` | `BOARD`, `Board`, `describeBoard`, `boardOf`                  |
| `tasks.changed` and `tasks.board` in the log                 | `board.changed`, and the board's own `pi-board:op` entries    |
| `SessionState.tasks` on the wire                             | `SessionState.board`                                          |
| the look's `tasks` segment                                   | `board`                                                       |
| a title on `session.named`, on a peer and in presence        | the handle only                                               |

Upgrade the daemon and the clients together. The shape of `SessionState` changed, and a 5.x client
does not know `board.changed`, so a phone on 5.x reading a 6.0.0 daemon shows no board.

A session written with 5.x opens as it was. Its tasks' paid model calls still count in its cost, and
it keeps the handle the tasks gave it.
