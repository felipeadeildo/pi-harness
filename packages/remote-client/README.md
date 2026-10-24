# @adeildo/pi-remote-client

What a client of pi-remote holds: the connection to the daemon, the cache it draws before the network
answers, and the session rebuilt from the protocol's shapes. There is no React in it, so the web app,
the native app and a viewing pi all use it.

```ts
const client = connect({ key, cache, open });
await client.load(); // draws the cache, then sends the hello with its cursors
client.on((session) => draw(transcriptOfSession(session), factsOf(session)));
```

A reconnect sends the cursor it stopped at. A new epoch, or a hole in the numbering, makes it ask for
a snapshot instead, because nothing else can put back what it missed.

The transport is the caller's, and so is the `Origin` header the daemon checks: a browser sets it, and
a client that is not a browser must set its own, or the daemon refuses the socket. The same goes for
the login cookie, which is why none of it lives here.
