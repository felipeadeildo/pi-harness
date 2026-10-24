# @adeildo/pi-remote-client

What a client of pi-remote holds: the connection to the daemon, the cache it draws before the network
answers, and the session rebuilt from the protocol's shapes. There is no React in it, so the web app,
the native app and a viewing pi all use it.

```ts
const client = connect({ key, cache, open });
await client.load(); // draws the cache, then sends the hello with its cursors
client.on((session) => draw(transcriptOfSession(session), factsOf(session)));
```

## The connection

`connect` takes the session key, a cache and the caller's transport. `load` draws the cache first and
then opens the connection; `on` is called with the session after the cache and after every change.
`stop` ends the connection and stops reconnecting.

A reconnect sends the cursor it stopped at. A new epoch, or a hole in the numbering, makes it ask for
a snapshot instead, because nothing else can put back what it missed.

`send` queues a command and returns it, and `outbox()` shows the commands that have not been answered
yet. A command typed while the daemon is out of reach waits and goes out on the next connection, and
a reply ends it as applied or refused.

## The session list

`listSessions` reads the daemon's `GET /sessions`, refuses a list where nothing decodes, and takes an
optional `signal`. `wantsYou`, `stateOf` and `inOrder` put the sessions that need the operator first
and give the list a stable order.

## The transport

The transport is the caller's, and so is the `Origin` header the daemon checks: a browser sets it, and
a client that is not a browser must set its own, or the daemon refuses the socket. The same goes for
the login cookie, which is why none of it lives here.

Part of [pi-harness](https://github.com/felipeadeildo/pi-harness), which brings every piece in one install.

<p align="center">
  <a href="https://adeildo.dev"><img src="https://adeildo.dev/assets/images/cat.svg" width="42" height="42" alt="adeildo.dev"></a><br>
  Brought to you by <a href="https://adeildo.dev">adeildo.dev</a>
</p>
