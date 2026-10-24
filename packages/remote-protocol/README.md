# @adeildo/pi-remote-protocol

The shapes that cross a process in pi-remote, and the reducers that turn a session's recording back
into what a screen draws.

It imports nothing: no pi, no kit, no `node:`. The daemon bundles it, the Expo app and the native app
use it, and `remote-client` reads it.

```ts
import { isEnvelope, reduceFacts, transcriptOf } from "@adeildo/pi-remote-protocol";

const transcript = transcriptOf(entries, leaf); // the branch, from the leaf the bridge names
const facts = reduceFacts(logged); // tasks, questions, rulings, mode, rename
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

## Facts

A fact is one thing the harness did, written to the session's log and sent as an event: the tasks, a
question opened or closed, a ruling on a call, the permission mode, the session's state, a rename, the
number of a streamed message bound to its entry, a move in the tree.

`FactMap` is the shape of each and `FACT_TYPES` is the closed list. `isFact` checks a fact against its
type, and `reduceFact` folds that list into `SessionFacts`: the tasks as they stand, the questions still
open, the ruling of each call, the mode and the rename. `openAsks` is the questions a screen should
draw.

The list only grows. A field a reviewer adds is optional, so a daemon of a later version still reduces
in a client of this one.

## The snapshot and the cursor

`SessionSnapshot` is where a client starts: the session's name, handle, model, state, tasks, mode,
cost, queue, and the entry its branch ends at. `isSnapshot` checks it, and checks the queue letter by
letter.

`Cursor` is what a reconnect sends: the last entry, the last fact position, and the last `seq` of the
epoch. The daemon replays what came after it, or answers with a snapshot when it cannot.

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

## The copied types

The kit's types are copied here instead of imported, because the kit is published and cannot depend on
a private package. `test/conformance.test.ts` imports the kit's own types and proves at compile time
that everything the protocol reads out of the log is a shape the kit writes. That proof is a type
proof: its judge is `bun run check`, not `bun test`.

Part of [pi-harness](https://github.com/felipeadeildo/pi-harness), which brings every piece in one install.

<p align="center">
  <a href="https://adeildo.dev"><img src="https://adeildo.dev/assets/images/cat.svg" width="42" height="42" alt="adeildo.dev"></a><br>
  Brought to you by <a href="https://adeildo.dev">adeildo.dev</a>
</p>
