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

Every pi start writes `~/.pi/agent/harness/remote/current.json`, which names the Node binary and the built command of the version that started, and `~/.pi/agent/harness/remote/bin/pi-remote`, a launcher that runs that command. The launcher never changes, so a service or a link in `~/.local/bin` keeps working across updates.
