# @adeildo/pi-remote

Your pi sessions from a phone, a browser or a pi on another machine. This package is being built and is not published yet. [`docs/remote.md`](../../docs/remote.md) has the design, and [`docs/remote-plan.md`](../../docs/remote-plan.md) has the work left.

It holds three programs:

- the bridge, an extension every pi loads (`src/index.ts`);
- the daemon, one per machine (`src/daemon/main.ts`, built into `dist/daemon.js`);
- the `pi-remote` command (`src/cli/main.ts`, built into `dist/cli.js`).

pi compiles an extension's TypeScript when it loads it, but nothing compiles the daemon or the command, and Node does not strip types from files under `node_modules`. So both are built into single JavaScript files that import nothing but Node's own modules:

```bash
bun run --cwd packages/remote build
```

Every pi start writes `~/.pi/agent/harness/remote/current.json`, which names the Node binary and the built files of the version that started, and the same values as shell assignments in `current.sh`. `~/.pi/agent/harness/remote/bin/pi-remote` is a launcher that sources `current.sh` and runs that command. The launcher never changes, so a service or a link in `~/.local/bin` keeps working across updates.

The bridge in a terminal session connects to the daemon on `~/.pi/agent/harness/remote/daemon.sock`, one JSON envelope per line. When nothing answers, it starts the daemon `current.json` names, detached, and keeps trying with a short backoff; it starts the daemon again at most every 10 seconds. A send never waits: while the daemon is away, nothing is sent, and on the next connection the bridge tells the daemon again what it must know. When more than 1 MB waits on the socket, the bridge drops streamed deltas until the socket drains, and past 8 MB it reconnects. A `pi -p` never connects.

On every connect the bridge says the session is live and sends a snapshot: what pi knows of the session, the last 50 entries of the branch and the message being written. It sends one again when the daemon asks with `snapshot.get`. After the snapshot it sends each entry pi appends, read through the kit's `piSource`, and the message being written in the shapes of pi's JSON mode. Deltas of one block are joined over 33 ms, and a running tool sends the last 4 KB of its output at most every 100 ms. Each message carries a `stream` number, and at the end of its turn `stream.bound` names the entry it became, so a client swaps the streamed copy for the entry. Moving in the tree sends `leaf.changed`. User messages and tool results are not streamed: they arrive as entries.

The bridge also sends the session's status in pi's program status words as `session.state`, and each fact the kit logs for the session: `tasks.changed`, `ask.opened`, `ask.closed`, `call.ruled`, `mode.changed`, `prompt.received` and `session.renamed`. The log's own `session.state` is peers' running or idle, so it stays behind. The snapshot carries the handle, the status, the tasks, the mode and the open questions. It also carries, as `facts`, the facts that rebuild that state, with the latest ruling of up to 100 calls, because a client reduces facts.

A session in RPC mode shows only when whoever started it set `PI_REMOTE_SHARE=1`, as the runner will. It shows as a background session.
