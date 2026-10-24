<h1 align="center">@adeildo/pi-remote-app</h1>

<p align="center">
  <strong>The pi-remote web app.</strong><br>
  Your sessions in a browser: the list, one session's transcript, and the login a link carries.
</p>

<p align="center"><code>pi-remote serve</code>, then open the link <code>/remote</code> prints.</p>

The daemon serves this app on the port it listens on, so there is nothing to install and no separate
server, and the app talks to the daemon on the page's own origin.

## Screens

| Where the browser is      | What it shows                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------- |
| `/`                       | The sessions this machine knows.                                                            |
| `/session/<machine>/<id>` | One session: its transcript, the tasks still open, and the question it waits on, read only. |

A session is read only until the composer lands in W4. Nothing here writes to the session yet.

## The login

The link carries `#token=…`. The app trades it for the login cookie at `POST /login`, takes the token out
of the address before the request goes out, and only then opens the socket. It happens once per page, and
a link without a token simply opens: the cookie is already there.

If the daemon cannot be reached, or refuses the link, the page says which of the two it was, because a
spent link and a daemon that is down need different things from the person reading.

## Text from elsewhere

A model's answer, a tool's output and a diff are drawn and never interpreted: a tag comes out as the
characters the model wrote, an image becomes a line naming where it lives, and a link becomes a link only
when it is http or https. The renderer builds DOM nodes rather than native views, so the app can reuse it
when the native screens arrive.

## Commands

From the repository root:

```bash
bun run app:export   # the web build, into apps/remote/dist
bun run app:check    # type check
bun run csp:check    # load the build through the daemon and fail on any policy violation
```

Inside `apps/remote` the same three are `bun run export`, `bun run check` and `bun run csp`. The CI job
runs the export and the policy check with a browser; `verify` runs only the type check.

## The policy

Every page comes with a policy that allows only the app's own scripts, with the hashes of the page's
inline ones. The daemon owns that policy and the app only consumes it, so `csp:check` loads the build the
way the daemon would serve it, and a page that would be blocked in someone's phone fails here first.

Part of [pi-harness](https://github.com/felipeadeildo/pi-harness), which brings every piece in one install.

<p align="center">
  <a href="https://adeildo.dev"><img src="https://adeildo.dev/assets/images/cat.svg" width="42" height="42" alt="adeildo.dev"></a><br>
  Brought to you by <a href="https://adeildo.dev">adeildo.dev</a>
</p>
