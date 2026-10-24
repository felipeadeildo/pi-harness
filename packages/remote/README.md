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
