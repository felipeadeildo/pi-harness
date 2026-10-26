<h1 align="center">@adeildo/pi-remote</h1>

<p align="center">
  <a href="https://pi.dev"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Ffelipeadeildo%2Fpi-harness%2Fmain%2Fpackage.json&query=%24.devDependencies%5B%22%40earendil-works%2Fpi-coding-agent%22%5D&label=pi%20SDK&color=6E56CF" alt="pi SDK"></a>
</p>

<p align="center">
  <strong>Your pi sessions from a phone or a browser.</strong><br>
  Every session on every machine of yours, live, from one address.
</p>

<p align="center">Pi has it as soon as this package is installed, and <code>/remote</code> opens it</p>

Three programs work together. A **bridge** runs inside every pi and publishes that session. A **daemon** runs once per machine and holds the stream, the replay and the login. A **`pi-remote`** command is there for a shell, to print and open a link.

## Opening it

`/remote` in pi prints a link, opens it and says it is good once, for a minute. `pi-remote open` does the same from a shell. Either way the browser gets every session on this machine, with the answer as it is written.

On a machine in a [Tailscale](https://tailscale.com) tailnet, the daemon also listens on the machine's tailnet address, and `/remote` names it by address, such as `http://100.101.102.103:7878/`, which works where MagicDNS does not. The machine's tailnet name answers too. A phone or a computer of yours on the same tailnet opens that address with no link and no token: the daemon asks `tailscale whois` who the device belongs to, and a device of the user who owns this machine gets its login with the first page. Nothing is set up for it, and a machine without Tailscale listens on loopback only. A machine that joins its tailnet after the daemon started gets a daemon that listens there within fifteen seconds.

## Your other machines

Every machine of yours on the tailnet that runs pi has its own daemon, and each daemon finds the others: `tailscale status` lists your machines that are online, and each one whose daemon answers at the same port is one of them. Nothing is paired. A daemon logs in at another the way your phone does, because `whois` says both machines are yours; a node another user shares into the tailnet is never one of them.

So one address shows everything. The list holds the sessions of every machine, and a session of another machine opens through the daemon you are talking to, which reads it from that machine's daemon and joins your socket to that machine's. A machine that stops answering leaves the list at the next look, every fifteen seconds.

The agents talk across machines too. Every two seconds each daemon copies what the others share: who is open there, into this machine's presence index, and the logs of the shared rooms, into this machine's rooms. So `Alt+G` lists the agents open on your other machines, a shared room can hold them, and a message reaches them the way it reaches an agent in the next terminal. A log has one writer and only grows, so copying it is appending what the other side has past this side's size, and nothing is ever merged. A session of a machine that stops answering is gone from the rooms within fifteen seconds; what it wrote stays. A folder's own room is not shared: the same path on two machines is two folders.

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

| Route                                | Answer                                                                                                      |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `GET /health`                        | Version, protocol, machine and uptime, with no login                                                        |
| `GET /sessions`                      | Every session of every machine, with its state; `?here` for this machine's only                             |
| `GET /sessions/:machine/:id/opening` | What a client draws first: the summary, the tail of the branch and the message being written                |
| `GET /sessions/:machine/:id/entries` | Older entries, read from pi's own session file (`?before=`, `?since=`, 200 a page)                          |
| `GET /ws?machine=`                   | The live stream of that machine's sessions: one hello per session, then its events                          |
| `POST /login`                        | Trades a link's token for the login cookie, or with no token logs in a device of the owner's on the tailnet |

A client that opens the stream says the cursor it stopped at, and gets what the daemon still holds after it, or the opening and what follows. A delta never leaves a hole, because a delta carries no sequence number: it only matters live, and the end of the message replaces it. A page of entries costs a few milliseconds after the first, which is the one that indexes the file.

A session also takes commands, and each one runs in its own process: a prompt, abort, compact, rename, stop, and the model, the thinking level and the permission mode. Each is answered on its id, and an id that already ran is answered as a repeat, so a command resent after a reconnect is not a second effect. `full` is refused from a client: that mode runs every call without asking, and it is set at the terminal.

## The page

The daemon serves the page on the same port: a React app in `web/`, built by Vite into `dist/web`. It answers with the files that were there when it started and with `index.html` for the page's own routes, after every data route, so a made-up path never reaches the filesystem and a file named like a route never answers for it. The page's files open with no login, because a browser loads them before it has one; anything else needs the cookie. Every file carries a policy that runs the page's own scripts and nothing else.

`PI_REMOTE_WEB` points at another build, and without one the daemon serves the data routes alone.

## Security

The port listens on loopback, and on the tailnet's address when the machine has one, never on every interface. A `Host` that is not one of the daemon's own names gets 421, so a page whose DNS name resolves to 127.0.0.1 reads nothing, and a WebSocket or a request that changes something needs the daemon's own `Origin`, or it gets 403: any page can open a socket, and an `Origin` is what it cannot forge. Everything else needs the login cookie, except health, the login route and the app's own files.

The token arrives in the URL's fragment, which no request carries to a server or a log, and travels once, in the body of the login. The cookie is `HttpOnly` and `SameSite=Strict`. On a machine other people log into they can read the link in the opener's command line while it runs, since any user can read a process's arguments: the first to trade a link gets the login, so trade it at once, and a 401 means someone else did.

On the tailnet, who a device is decides its login, and only a device of the user who owns this machine gets one that way. A node another user shares into the tailnet, a `whois` that fails, or one that takes longer than two seconds, gets no login, and that device needs a link like any other. A whois answer is kept for a minute. So a device of yours that is lost or taken logs in until you remove it from the tailnet. The tailnet's traffic is encrypted by WireGuard, and the daemon speaks plain HTTP on it, so the cookie is not `Secure` there.

The agent runs with your permissions, so the permission feature asks before any call that reaches this package: it answers its own session's questions and reads its folder.

## Building it

`bun run build` in this package writes the two programs and the page. pi compiles the bridge itself when it loads it; the daemon and the command ship as one file each that imports nothing but Node's own modules, because nothing else compiles them.

Part of [pi-harness](https://github.com/felipeadeildo/pi-harness), which brings every piece in one install.

<p align="center">
  <a href="https://adeildo.dev"><img src="https://adeildo.dev/assets/images/cat.svg" width="42" height="42" alt="adeildo.dev"></a><br>
  Brought to you by <a href="https://adeildo.dev">adeildo.dev</a>
</p>
