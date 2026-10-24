<h1 align="center">@adeildo/pi-remote</h1>

<p align="center">
  <a href="https://pi.dev"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Ffelipeadeildo%2Fpi-harness%2Fmain%2Fpackage.json&query=%24.devDependencies%5B%22%40earendil-works%2Fpi-coding-agent%22%5D&label=pi%20SDK&color=6E56CF" alt="pi SDK"></a>
</p>

<p align="center">
  <strong>Your pi sessions from a phone, a browser or a pi on another machine.</strong><br>
  Every session on this machine, live, with nothing to open first.
</p>

<p align="center"><code>bun run --cwd packages/remote build</code> and then <code>/remote</code> in pi</p>

The package holds three programs. The **bridge** is the extension every pi loads: it publishes this session to the daemon and carries the stream to whoever watches. The **daemon** is one per machine, and everything else talks to it. The **`pi-remote`** command is for a shell: it asks for a link and opens it.

pi compiles an extension's TypeScript when it loads it, and nothing compiles the other two, so both are built into single files that import only Node's own modules.

## Starting it

In pi, `/remote` prints a link, opens it and says it is good once, for a minute. In a shell, `pi-remote open` does the same. Either way the browser gets an app with every session on this machine, the live answer as it is written, and the login that keeps it open.

| Command                 | What it does                                                                                   |
| ----------------------- | ---------------------------------------------------------------------------------------------- |
| `pi-remote open`        | Prints the link and opens it with `$BROWSER` or the platform's opener                          |
| `pi-remote serve`       | Runs the daemon in the foreground, and never exits for being idle                              |
| `pi-remote serve --dev` | Runs it from the checkout under `bun --watch`, so a save restarts it; needs a checkout and Bun |
| `pi-remote --version`   | The version the launcher points at                                                             |

Both `serve` forms take `--port` for the clients' port, 7878 by default, and the link is built with the port the daemon opened, so `--port` moves it too.

The daemon starts by itself: a bridge that finds nothing on the socket starts it detached, from the build the version it names wrote, and the launcher in `~/.pi/agent/harness/remote/bin/pi-remote` always points at the pi that started last. Nothing to enable, and nothing to keep running after the last session goes: with no session connected for five minutes the daemon exits and removes its socket.

## What it writes

Everything lives in `~/.pi/agent/harness/remote`, or wherever `PI_REMOTE_DIR` says.

| File            | What it is                                                                                                              |
| --------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `daemon.sock`   | The socket bridges and `pi-remote` speak on: one JSON envelope per line, mode 0600                                      |
| `current.json`  | The Node binary and the built files of the version that started last, and the same as shell assignments in `current.sh` |
| `bin/pi-remote` | The launcher that sources `current.sh`, so a link or a service survives an update                                       |
| `logins.json`   | The SHA-256 of every live login cookie, mode 0600, so a login survives a restart                                        |

A second daemon that finds the first answering exits, and a socket left by one that died is replaced by the daemon holding `daemon.sock.lock`, so two starting together never remove each other's file. The daemon also steps aside for an upgrade: a newer bridge saying hello, or `current.json` naming a newer version, ends it and the next bridge starts the new one.

## What a client sees

Clients reach the daemon on `127.0.0.1:7878`.

| Route                                 | Answer                                                                         |
| ------------------------------------- | ------------------------------------------------------------------------------ |
| `GET /health`                         | Version, protocol and uptime, with no login                                    |
| `GET /sessions`                       | Every session a bridge registered, with its state and facts                    |
| `GET /sessions/:machine/:id/snapshot` | The session's last snapshot, with the facts that rebuild its state             |
| `GET /sessions/:machine/:id/entries`  | Older entries, read from pi's session file (`?before=`, `?since=`, 200 a page) |
| `GET /ws`                             | The live stream: one hello per session, and then its events                    |
| `POST /login`                         | Trades a link's token for the login cookie                                     |

A client that opens the stream says the cursor it stopped at. The daemon sends what it still holds after that cursor, or the last snapshot and what follows it, or asks the bridge for a fresh one; a delta the daemon never kept is never a hole, because a delta carries no sequence number. A session also takes commands, which run in its own process: abort, compact, rename, stop, and the model, the thinking level and the permission mode. Each is answered on its id, and an id that already ran is answered as a repeat, so a resend after a reconnect is not a second effect. `full` is refused from a client: that mode runs every call without asking, and it is set at the terminal.

## The app

The daemon serves the web app on the same port, from the export the build copies to `dist/web` with a `files.json` listing every path. It answers only from that list, after every data route, so a made-up path never reaches the filesystem and a file named like a route never answers for it. The export's own files open with no login, because a browser loads them before it has one; everything else needs the cookie. Each page carries a policy with the hashes of its own inline scripts.

`PI_REMOTE_WEB` points at another export, and without one the daemon serves the data routes alone. `@adeildo/pi-remote/preview` serves an export through the same code, which is how the app's policy check sees what the daemon would send. A daemon that serves a session through a tunnel wants a TLS terminator in front of it: this one speaks plain HTTP on loopback.

## Security

The port listens on loopback only, and every request passes the same gate. A `Host` that is not the daemon's own loopback name gets 421, so a page whose DNS name resolves to 127.0.0.1 reads nothing. A WebSocket, or a request that changes something, needs the daemon's own `Origin`, or it gets 403: any page can open a socket, and an `Origin` is what it cannot forge. Everything after that needs the login cookie, except `GET /health`, `GET /.well-known/pi-remote`, `POST /login` and the app's own files.

The token arrives in the URL's fragment, which no request carries to a server or a log, and travels once, in the body of `POST /login`. The cookie is `HttpOnly` and `SameSite=Strict`, and the daemon keeps only its SHA-256. On a machine other people log into they can read the link in the opener's command line while it runs, since any user can read a process's arguments: the first to trade a link gets the login, so trade it at once, and a 401 means someone else did.

The agent runs with your permissions, so the permission feature asks before any call that reaches this package: it answers its own session's questions and reads its folder.

Part of [pi-harness](https://github.com/felipeadeildo/pi-harness), which brings every piece in one install.

<p align="center">
  <a href="https://adeildo.dev"><img src="https://adeildo.dev/assets/images/cat.svg" width="42" height="42" alt="adeildo.dev"></a><br>
  Brought to you by <a href="https://adeildo.dev">adeildo.dev</a>
</p>
