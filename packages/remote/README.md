<h1 align="center">@adeildo/pi-remote</h1>

<p align="center">
  <a href="https://pi.dev"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Ffelipeadeildo%2Fpi-harness%2Fmain%2Fpackage.json&query=%24.devDependencies%5B%22%40earendil-works%2Fpi-coding-agent%22%5D&label=pi%20SDK&color=6E56CF" alt="pi SDK"></a>
</p>

<p align="center">
  <strong>Your pi sessions from a phone, a browser or a pi on another machine.</strong><br>
  Every session on this machine, live, with nothing to open first.
</p>

<p align="center">Pi has it as soon as this package is installed, and <code>/remote</code> opens it</p>

Three programs work together. A **bridge** runs inside every pi and publishes that session. A **daemon** runs once per machine and holds the stream, the replay and the login. A **`pi-remote`** command is there for a shell, to print and open a link.

## Opening it

`/remote` in pi prints a link, opens it and says it is good once, for a minute. `pi-remote open` does the same from a shell. Either way the browser gets every session on this machine, with the answer as it is written.

On a machine in a [Tailscale](https://tailscale.com) tailnet, the daemon also listens on the machine's tailnet address, and `/remote` names it by address, such as `http://100.101.102.103:7878/`, which works where MagicDNS does not. The machine's tailnet name answers too. A phone or a computer of yours on the same tailnet opens that address with no link and no token: the daemon asks `tailscale whois` who the device belongs to, and a device of the user who owns this machine gets its login with the first page. Nothing is set up for it, and a machine without Tailscale listens on loopback only.

| Command                 | What it does                                                          |
| ----------------------- | --------------------------------------------------------------------- |
| `pi-remote open`        | Prints the link and opens it with `$BROWSER` or the platform's opener |
| `pi-remote serve`       | Runs the daemon in the foreground, and it never exits for being idle  |
| `pi-remote serve --dev` | Runs it from the sources under `bun --watch`, so a save restarts it   |
| `pi-remote --version`   | The version the launcher points at                                    |

Both serve forms take `--port` for the clients' port, 7878 by default, and the link is built from the port the daemon opened, so `--port` moves it too.

A pi running without a terminal, as `pi -p` does, shows up when it starts with `PI_REMOTE_SHARE=1`: otherwise it leaves no trace on purpose.

Nothing has to be started by hand: a bridge that finds no daemon starts one, detached, and the launcher always points at the pi that started last, so an update needs no new service. With no session connected for five minutes the daemon exits and its socket goes with it. A second daemon that finds the first answering steps aside, and so does one whose version an update has passed.

The daemon keeps its own state in `~/.pi/agent/harness/remote`, and `PI_REMOTE_DIR` moves it. A login outlives a restart; the tokens and cookies themselves are never written down, only their hashes.

## What a client sees

Clients reach the daemon on `127.0.0.1:7878`, and on the tailnet's name and address at the same port when the machine has one.

| Route                                 | Answer                                                                                                      |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `GET /health`                         | Version, protocol and uptime, with no login                                                                 |
| `GET /sessions`                       | Every session a bridge registered, with its state and facts                                                 |
| `GET /sessions/:machine/:id/snapshot` | The session's last snapshot, with the facts that rebuild its state                                          |
| `GET /sessions/:machine/:id/entries`  | Older entries, read from pi's own session file (`?before=`, `?since=`, 200 a page)                          |
| `GET /ws`                             | The live stream: one hello per session, then its events                                                     |
| `POST /login`                         | Trades a link's token for the login cookie, or with no token logs in a device of the owner's on the tailnet |

A client that opens the stream says the cursor it stopped at, and gets what the daemon still holds after it, or the last snapshot and what follows, or a fresh snapshot asked of the bridge. A delta never leaves a hole, because a delta carries no sequence number: it only matters live, and the end of the message replaces it. A page of entries costs a few milliseconds after the first, which is the one that indexes the file.

A session also takes commands, and each one runs in its own process: abort, compact, rename, stop, and the model, the thinking level and the permission mode. Each is answered on its id, and an id that already ran is answered as a repeat, so a command resent after a reconnect is not a second effect. `full` is refused from a client: that mode runs every call without asking, and it is set at the terminal.

## The app

The daemon serves the web app on the same port, from the export the build makes. It answers only for paths the export listed, after every data route, so a made-up path never reaches the filesystem and a file named like a route never answers for it. The export's own files open with no login, because a browser loads them before it has one; anything else needs the cookie. Each page carries a policy that allows its own inline scripts and nothing else.

`PI_REMOTE_WEB` points at another export, and without one the daemon serves the data routes alone. The app's policy check loads the export through the daemon's own code, so it sees exactly what a browser would get. The app's policy check loads the export through the daemon's own code, so it sees exactly what a browser would get.

## Security

The port listens on loopback, and on the tailnet's address when the machine has one, never on every interface. A `Host` that is not one of the daemon's own names gets 421, so a page whose DNS name resolves to 127.0.0.1 reads nothing, and a WebSocket or a request that changes something needs the daemon's own `Origin`, or it gets 403: any page can open a socket, and an `Origin` is what it cannot forge. Everything else needs the login cookie, except health, the login route and the app's own files.

The token arrives in the URL's fragment, which no request carries to a server or a log, and travels once, in the body of the login. The cookie is `HttpOnly` and `SameSite=Strict`. On a machine other people log into they can read the link in the opener's command line while it runs, since any user can read a process's arguments: the first to trade a link gets the login, so trade it at once, and a 401 means someone else did.

On the tailnet, who a device is decides its login, and only a device of the user who owns this machine gets one that way. A node another user shares into the tailnet, a `whois` that fails, or one that takes longer than two seconds, gets no login, and that device needs a link like any other. A whois answer is kept for a minute. So a device of yours that is lost or taken logs in until you remove it from the tailnet. The tailnet's traffic is encrypted by WireGuard, and the daemon speaks plain HTTP on it, so the cookie is not `Secure` there.

The agent runs with your permissions, so the permission feature asks before any call that reaches this package: it answers its own session's questions and reads its folder.

## Building it

`bun run build` in this package writes the two programs and the app's export. pi compiles the bridge itself when it loads it; the daemon and the command ship as one file each that imports nothing but Node's own modules, because nothing else compiles them.

Part of [pi-harness](https://github.com/felipeadeildo/pi-harness), which brings every piece in one install.

<p align="center">
  <a href="https://adeildo.dev"><img src="https://adeildo.dev/assets/images/cat.svg" width="42" height="42" alt="adeildo.dev"></a><br>
  Brought to you by <a href="https://adeildo.dev">adeildo.dev</a>
</p>
