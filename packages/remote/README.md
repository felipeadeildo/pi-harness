# @adeildo/pi-remote

Your pi sessions from a phone, a browser or a pi on another machine. The package is being built and is
not published yet.

Three programs live here: the **bridge**, an extension every pi loads (`src/index.ts`); the **daemon**,
one per machine (`src/daemon/main.ts`); and the **`pi-remote`** command (`src/cli/main.ts`). pi compiles
an extension's TypeScript when it loads it, but nothing compiles the other two, and Node does not strip
types from a package under `node_modules`. So both are bundled into one file each, importing nothing but
Node's own modules:

```bash
bun run --cwd packages/remote build
```

That also exports the web app and copies it to `dist/web`. `dist/` is what the command and the daemon run.

## The files

```
~/.pi/agent/harness/remote/      PI_REMOTE_DIR moves it
  daemon.sock                    the bridges and the command talk here
  current.json                   the built files and version of the last pi that started
  current.sh                     the same values as shell assignments, for the launcher
  logins.json                    the hashes of the tokens and cookies, mode 0600
  bin/pi-remote                  a launcher that sources current.sh
```

Every pi start writes `current.json` and `current.sh`, and, when its text changed, the launcher. The
launcher never changes after that, so a service or a link in `~/.local/bin` keeps working across
updates.

## The bridge

The bridge connects to `daemon.sock`, one JSON envelope per line, and starts the daemon `current.json`
names when nothing answers. It starts it again at most every 10 seconds, and a send never waits: while
the daemon is away nothing is sent, and the next connection tells it again what it must know. Past 1 MB
waiting on the socket it drops streamed deltas until the socket drains, and past 8 MB it reconnects. A
`pi -p` never connects, and a session in RPC mode shows only when its starter set `PI_REMOTE_SHARE=1`.

On every connect it says the session is live, with the path of pi's session file, and sends a snapshot:
what pi knows of the session, the last 50 entries of the branch, and the message being written. It sends
one again when the daemon asks with `snapshot.get`. After that it sends each entry pi appends and the
message being written in the shapes of pi's JSON mode. Deltas of one block are joined over 33 ms, and a
running tool sends the last 4 KB of its output at most every 100 ms. **A delta and a running tool's
output carry no `seq`**: they matter only live, the message's end replaces them, and the numbered events
a daemon replays have no hole for it. Each message carries a `stream` number and, at the end of its turn,
`stream.bound` names the entry it became, so a client swaps the streamed copy for the entry.
`leaf.changed` comes when the tree moves, and `leaf: null` is the root.

It also sends `session.state` in pi's program status words, and each fact the kit logs for the session.
The log's own `session.state` is peers' running or idle, so it stays behind. The snapshot carries the
handle, the status, the tasks, the mode, the open questions and the facts that rebuild that state.

## The daemon

The socket is the lock. The daemon binds a path of its own and links `daemon.sock` to it, so a second
daemon finds the first answering and exits; a socket left by a daemon that died is replaced by the one
holding `daemon.sock.lock`. On stop it removes the socket only if it is still its own.

A bridge's first message must be a `bridge` hello in the daemon's protocol, and after that the daemon
reads only its session and epoch. It keeps every session a bridge registered, with the facts reduced from
its events, its last snapshot, and a replay buffer of 8 MB across all sessions. The snapshot is kept
whole, one per session, outside those 8 MB: a client that cannot replay takes it, so it cannot be
dropped. A client gets the events after its cursor, or the last snapshot and what came after it, or the
snapshot it asks the bridge for with `snapshot.get`. Streamed deltas are never kept. A bridge whose
socket closes leaves its session listed as reconnecting. With no session connected for 5 minutes the
daemon exits, and it also exits for an upgrade, when a newer bridge says hello or `current.json` names a
newer version.

## The clients' port

Clients reach the daemon on `127.0.0.1:7878`, loopback only, and every request passes `authorize` first.
A `Host` that is not the daemon's own loopback name gets 421, so a page whose DNS name turns into
127.0.0.1 reads nothing, and a WebSocket or a request that changes something needs the daemon's own
`Origin` or it gets 403. Every request after that needs the login cookie, except `GET /health`,
`GET /.well-known/pi-remote`, `POST /login` and the files of the web build, or it gets 401.

`GET /health` says its version, protocol and uptime. `GET /sessions` lists every session a bridge
registered with its state and facts. `GET /sessions/:machine/:id/snapshot` returns the last snapshot with
its facts, and `GET /sessions/:machine/:id/entries` returns older entries read from the session file:
`?before=<id>` walks the branch back from that entry's parent, `?since=<id>` gives what pi appended after
it, and no cursor gives the tail. A page holds at most 200 entries, an entry the file does not hold
answers 410, and the daemon serves only a file whose header names the session. It keeps an index of each
paged file, for at most 16, built 256 KB at a time with a yield after each, so a 32 MB session holds the
event loop for about 20 ms and a page after the first takes a few milliseconds. `GET /ws` is the live
stream. It is written against Node's own modules: text frames, ping, pong, close, no extensions, and a
message over 1 MB closes the connection. A client with more than 8 MB unsent is closed and reconnects
from its cursor.

Commands travel as `{ id, type, data, by }` in an envelope, and answer with `reply` or `error` on the
same `id`, so a resend is a repeat instead of a second effect. The list of commands, the facts and the
snapshot are `@adeildo/pi-remote-protocol`.

## The web app

The daemon serves the app on the same port, from `dist/web`. `files.json`, written by the build, lists
every file as a path from `/`, and the daemon answers only from that list, after every data route, so a
path a client makes up never reaches the filesystem and a file named like a route never answers for it.
A path is its file, its page (`/x` is `/x.html` or `/x/index.html`), or the page of a route with
parameters (`/session/[machine]/[id].html` answers `/session/laptop/01a1`). Each page carries the policy
from `src/daemon/web.ts` with the hashes of its own inline scripts; every other file carries the base
policy, and anything the export does not have gets its not-found page with 404. The daemon looks for the
export next to itself, then in the package's `dist/web`, and `PI_REMOTE_WEB` points elsewhere. Without an
export it serves the data routes alone. `@adeildo/pi-remote/preview` serves an export through the same
code, which is how the app's policy check sees what the daemon would send.

## The login

`/remote` in pi, or `pi-remote open` in a shell, asks the daemon for a link with a token good once, for
60 seconds, prints it and opens it with `$BROWSER` or the platform's opener. The link is built with the
port the daemon listens on, so `serve --port` moves it. The token rides in the URL's fragment, which no
request carries; the app posts it in the body of `POST /login`, never in the query, and gets an HttpOnly,
`SameSite=Strict` cookie that lasts a year from its last use. Only the SHA-256 of tokens and cookies is
kept, in `logins.json`, so a login survives a restart. On a machine other people log into, any user can
read the link in the opener's command line while it runs, and the first to trade it gets the login, so
trade it at once; a 401 means someone else did.

## The command

```
pi-remote --version
pi-remote open                    prints a link and opens it
pi-remote serve [--port <n>]      the daemon in the foreground, never idle
pi-remote serve --dev [--port <n>]  from src/ under bun --watch, restarting on every save
```

`--port` is the clients' port, 7878 by default.

Part of [pi-harness](https://github.com/felipeadeildo/pi-harness), which brings every piece in one install.

<p align="center">
  <a href="https://adeildo.dev"><img src="https://adeildo.dev/assets/images/cat.svg" width="42" height="42" alt="adeildo.dev"></a><br>
  Brought to you by <a href="https://adeildo.dev">adeildo.dev</a>
</p>
