# @adeildo/pi-remote-protocol

What crosses a process in pi-remote, the reducers that turn a session's recording back into what a
screen draws, and, under `/client`, what a client holds of it: the connection, the cache and the session
rebuilt from the wire.

It imports nothing: no pi, no kit, no `node:`. The daemon bundles it, and the web app runs it in the
browser.

```ts
import { foldLogged, isEnvelope, transcriptOf } from "@adeildo/pi-remote-protocol";

const transcript = transcriptOf(entries, leaf); // the branch, from the leaf the bridge names
const state = foldLogged(logged); // questions, rulings, mode, board, cost, queue
```

## The envelope

Every message is one line of JSON shaped like `Envelope`, and `PROTOCOL` is its version, which both
sides check in the hello.

| Field                         | What it is                                                                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `v`                           | The protocol version, `1`.                                                                                                            |
| `kind`                        | `hello`, `event`, `state`, `command`, `reply` or `error`.                                                                             |
| `machine`, `session`, `epoch` | Which session, and which life of its process. A new epoch means the numbering started over.                                           |
| `seq`                         | The event's position in the epoch. It is what a reconnect resumes from. An event without one only matters live and is never replayed. |
| `id`                          | Set on a `command` and on the `reply` or `error` that answers it.                                                                     |
| `at`, `type`, `data`, `by`    | When, what, its payload, and who caused it.                                                                                           |

`isEnvelope` checks one, and is the only thing a reader should trust before reading the rest.

## State changes

A state change is one thing the harness did, written to the session's log and sent as an event: a
question opened or closed, a ruling on a call, the permission mode, the session's status, the number
of a streamed message bound to its entry, a move in the tree, the queue, the cost.

Each one is an entry of one table, with the shape its check names, the check, and what it does to the
state, so `StateChangeMap` is read from the table and a change is added in one place. `STATE_CHANGES` is
the closed list, `isStateChangeType` names one, and `applyChange` folds it into `SessionState`, skipping
one whose shape does not check. `foldLogged` folds a whole log, and `openQuestions` is the questions a
screen should draw.

The list only grows. A field a later version adds is optional, so a daemon of a later version still reduces
in a client of this one.

## The opening

`SessionSummary` is where a client starts: the session's name, handle, model, state, board, mode,
cost, queue, and the entry its branch ends at. `isSummary` checks it, and checks the queue letter by
letter.

A reconnect says where it stopped — the last entry it holds and the last `seq` of the epoch — and the
daemon replays what came after, or answers with an opening when it cannot. The cursor itself belongs to
the client; this package carries the opening and the envelopes that it resumes between.

## Commands

`COMMAND_TYPES` is what a client may ask a session to do; `CommandMap` is the payload of each and
`isCommand` checks one. A command carries an `id`, and the session answers on the same `id` with a
`reply` or an `error`: a resent id is a repeat and not a second effect.

The set is closed on purpose. A type a session does not know is refused with a reason, instead of
running and doing nothing.

## Reducers

`transcriptOf` walks a branch from its leaf back through each entry's parent, and returns the items a
screen draws: messages in parts, compactions, branch summaries, model changes, and the entries a newer
pi writes that this version keeps without inventing a shape.

## The client

`@adeildo/pi-remote-protocol/client` is what a client of pi-remote holds: the connection to the
daemon, the cache it draws before the network answers, and the session rebuilt from the shapes above.
There is no React in it.

```ts
import { connect, transcriptOfSession } from "@adeildo/pi-remote-protocol/client";

const client = connect({ key, cache, open });
await client.load(); // draws the cache, then sends the hello with its cursors
client.on((session) => draw(transcriptOfSession(session), session.state));
```

`connect` takes the session key, a cache and the caller's transport. `load` draws the cache first and
then opens the connection. `on` is called with the session after the cache and after every change, and
`stop` ends the connection and stops reconnecting.

A reconnect sends the cursor it stopped at. A new epoch, or a hole in the numbering, makes it ask for
an opening instead, because nothing else can put back what it missed.

`send` queues a command and returns it, and `outbox()` shows the commands that have not been answered
yet. A command typed while the daemon is out of reach waits and goes out on the next connection, and a
reply ends it as applied or refused.

`listSessions` reads the daemon's `GET /sessions`, refuses a list where nothing decodes, and takes an
optional `signal`. `wantsYou`, `stateOf` and `inOrder` put the sessions that need the operator first
and give the list a stable order.

The transport is the caller's, and so is the `Origin` header the daemon checks: a browser sets it, and a
client that is not a browser sets its own, or the daemon refuses the socket. The same goes for the login
cookie, which is why none of it lives here.

## The copied types

The kit's types are copied here instead of imported, because the kit is published and cannot depend on
a private package. A conformance test compiles the kit's own types against the copies, so a field the
kit gains breaks this build before it breaks a reader. It is a type proof, which means the type check
is what fails, not the test run.

<!-- docs:footer -->

<p align="center">
  <a href="https://adeildo.dev"><img src="https://adeildo.dev/assets/images/cat.svg" width="42" height="42" alt="adeildo.dev"></a><br>
  <a href="https://github.com/felipeadeildo/pi-harness">pi-harness</a> is made by <a href="https://adeildo.dev">adeildo.dev</a>
</p>

<!-- /docs -->
