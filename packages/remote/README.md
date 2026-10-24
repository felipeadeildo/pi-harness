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

A session in RPC mode shows only when whoever started it set `PI_REMOTE_SHARE=1`, as the runner will. It shows as a background session.

The daemon listens on that socket with mode 0600. Binding it is the lock: a second daemon finds the first one answering and exits, and a socket file left by a daemon that died is removed and bound again. A bridge's first message must be a `bridge` hello in the daemon's protocol, and the daemon answers with its own. After that it reads only that bridge's session and epoch. It keeps every session a bridge registered, with the facts reduced from its events, its last snapshot, and a replay buffer of 8 MB across all sessions. A client that missed some events gets them from its cursor, and one whose cursor is older than the last snapshot, than what the budget dropped, or than the epoch takes the snapshot instead. Streamed deltas are never kept. A bridge whose socket closes leaves its session listed as reconnecting, and `session.gone` marks it ended. With no session connected for 5 minutes, the daemon exits and removes its socket. It also exits for an upgrade, when a newer bridge says hello or `current.json` names a newer version, and the next bridge that finds nothing starts the new one.
