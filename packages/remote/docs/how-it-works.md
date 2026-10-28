# How the remote works

The [README](../README.md) covers how to open it. This page covers the rest.

Three programs work together. A **bridge** runs inside every pi and publishes its session. A **daemon** runs once per machine and keeps the live sessions, a replay of recent events and the logins. The **`pi-remote`** command prints and opens a link from a shell.

## Signing in from your phone

On a machine in a [Tailscale](https://tailscale.com) tailnet, the daemon also listens on the machine's tailnet address. `/remote` prints that address, such as `http://100.101.102.103:7878/`, which works even where MagicDNS does not, and the machine's tailnet name works too.

Your phone, or any other device of yours on the same tailnet, opens that address with no link and no token. The daemon asks `tailscale whois` who owns the device, and a device of the person who owns this machine is signed in with the first page. There is nothing to set up. A machine without Tailscale listens on loopback only, and a machine that joins a tailnet later gets a daemon that listens there within fifteen seconds.

When you add the page to your home screen, the shortcut gets the pi-harness icon.

## Your other machines

Each machine of yours that runs pi has its own daemon, and the daemons find each other. `tailscale status` lists your machines that are online, and every one whose daemon answers on the same port joins the list. Nothing is paired. One daemon signs in at another the same way your phone does, because `whois` says both machines are yours. A machine that someone else shares into your tailnet never joins.

So one address shows everything. The session list has the sessions of every machine. When you open a session of another machine, the daemon you are talking to reads it from that machine's daemon and connects you to it. The **Machines** page lists each machine with its harness version, how long its remote has been up and how many sessions it has open. A machine that stops answering stays there, dimmed, with when it last answered.

Agents talk across machines too. Every two seconds, each daemon copies what the others share: which sessions are open there, and the logs of the shared rooms. So `Alt+G` lists the agents on your other machines, a shared room can hold them, and a message reaches them like it reaches an agent in the next terminal. Each log has one writer and only grows, so a copy only appends what is new, and nothing needs merging. When a machine stops answering, its sessions leave the rooms within fifteen seconds, and what they wrote stays. A folder's own room is not shared, because the same path on two machines is two different folders.

## The daemon

You never start the daemon by hand. When a bridge finds no daemon, it starts one in the background. A launcher in the remote's folder always points at the pi that started last, so an update needs no new service. The daemon exits after five minutes with no session connected. When a second daemon finds the first one answering, it steps aside, and so does a daemon that an update has made old.

| Command                 | What it does                                                               |
| ----------------------- | -------------------------------------------------------------------------- |
| `pi-remote open`        | Prints the link and opens it with `$BROWSER` or the system's opener        |
| `pi-remote serve`       | Runs the daemon in the foreground, and it never exits for being idle       |
| `pi-remote serve --dev` | Runs it from the sources under `bun --watch`, so saving a file restarts it |
| `pi-remote --version`   | Prints the version the launcher points at                                  |

Both `serve` forms take `--port`, which is 7878 by default, and the link uses the port the daemon opened.

A pi that runs without a terminal, as `pi -p` does, stays off the list on purpose. Start it with `PI_REMOTE_SHARE=1` to share it.

The daemon keeps its state in `~/.pi/agent/harness/remote`, and `PI_REMOTE_DIR` moves it. A login survives a restart. The daemon never writes a token or a cookie to disk, only its hash.

## Routes, for anyone writing a client

Clients reach the daemon on `127.0.0.1:7878`, and on the machine's tailnet name and address at the same port when it has them. [`@adeildo/pi-remote-protocol`](../../remote-protocol) has the shapes and a client library.

| Route                                | What it answers                                                                                      |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `GET /health`                        | The version, the protocol, the machine and the uptime, with no login                                 |
| `GET /sessions`                      | Every session of every machine, with its state; `?here` for this machine's only                      |
| `GET /tailnet`                       | This machine and the others that answered, with their versions and when each was last seen           |
| `GET /sessions/:machine/:id/opening` | What a client draws first: the summary, the end of the branch and the message being written          |
| `GET /sessions/:machine/:id/entries` | Older entries, read from pi's own session file (`?before=`, `?since=`, 200 per page)                 |
| `GET /ws?machine=`                   | The live stream of that machine's sessions: one hello per session, then its events                   |
| `POST /login`                        | Trades a link's token for the login cookie, or signs in your own device on the tailnet with no token |

A client that opens the stream sends the cursor where it stopped. It gets what the daemon still holds after that point, or the opening and everything after it. The stream never leaves a gap: a delta has no sequence number because it only matters live, and the end of the message replaces it. After the first page of entries, which indexes the file, a page takes a few milliseconds.

A client can also send commands to a session: a prompt, abort, compact, rename, stop, and a change of model, thinking level or permission mode. Each command gets an answer on its id. When an id already ran, the daemon answers that it is a repeat, so a command sent again after a reconnect does not run twice. The page asks you before it sets the `full` mode, because `full` runs every call without asking.

## The page

The daemon serves the page on the same port. It is a React app in `web/`, which Vite builds into `dist/web`. The daemon answers with the files it found when it started, and with `index.html` for the page's own routes, which it checks after every data route. So a made-up path never reaches the filesystem, and a file named like a route never answers for it. The page's files open with no login, because a browser loads them before it has one, and everything else needs the cookie. Every file carries a policy that lets only the page's own scripts run.

`PI_REMOTE_WEB` points the daemon at another build. Without a build, the daemon serves the data routes only.

## Security

The daemon listens on loopback, and on the tailnet address when the machine has one, never on every interface. A request whose `Host` is not one of the daemon's own names gets 421, so a site whose DNS name points at 127.0.0.1 reads nothing. A WebSocket, or a request that changes something, needs the daemon's own `Origin` or gets 403: any site can open a socket, but no site can fake its `Origin`. Everything else needs the login cookie, except `/health`, the login route and the page's own files.

The token travels in the URL's fragment, which a browser never sends to a server or a log, and then once in the body of the login. The cookie is `HttpOnly` and `SameSite=Strict`. On a machine that other people log into, they can read the link in the opener's command line while it runs, since any user can read the arguments of a process. Whoever trades the link first gets the login, so open it right away. If you get a 401, someone else used it.

On the tailnet, the device's owner decides the login, and only a device of the person who owns this machine gets one. A machine that someone else shares into the tailnet, a `whois` that fails, or a `whois` that takes more than two seconds gets no login, and that device needs a link like any other. The daemon remembers a `whois` answer for one minute. A device of yours that is lost or stolen can sign in until you remove it from the tailnet. WireGuard encrypts the tailnet's traffic, and the daemon speaks plain HTTP on it, so the cookie is not `Secure` there.

The agent runs with your permissions, so the permission feature asks before any call that touches this package. It answers its own session's questions and reads its own folder.

## Building it

`bun run build` in this package writes the two programs and the page. pi compiles the bridge itself when it loads it. The daemon and the command ship as one file each that imports only Node's own modules, because nothing else compiles them.

`bun run docs:remote`, from the repository's root, draws the phone screens above: it starts a daemon and a pi session with a scripted model, drives the page in a phone-sized browser and saves the screens to `assets/`.

<!-- docs:footer -->

<p align="center">
  <a href="https://adeildo.dev"><img src="https://adeildo.dev/assets/images/cat.svg" width="42" height="42" alt="adeildo.dev"></a><br>
  <a href="https://github.com/felipeadeildo/pi-harness">pi-harness</a> is made by <a href="https://adeildo.dev">adeildo.dev</a>
</p>

<!-- /docs -->
