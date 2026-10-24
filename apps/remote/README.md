<h1 align="center">@adeildo/pi-remote-app</h1>

<p align="center">
  <strong>The pi-remote web app.</strong><br>
  Your sessions in a browser: the list, one session's transcript, and the login a link carries.
</p>

<p align="center"><code>pi-remote serve</code>, then open the link <code>/remote</code> prints.</p>

The daemon serves this app on the clients' port, so there is nothing to install and no separate server.
The build puts the export where the daemon looks for it (`packages/remote/dist/web`), and the app talks
to the daemon on the page's own origin.

## Screens

| Route                     | What it draws                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------- |
| `/`                       | The sessions this machine knows, from `GET /sessions`.                                      |
| `/session/<machine>/<id>` | One session: its transcript, the tasks still open, and the question it waits on. Read only. |

`src/app/` holds routes and nothing else. Everything else lives under `src/screens`, `src/session` and
`src/render`, and a route file stays thin enough to read in one look.

## The login

A link from `/remote` or `pi-remote open` carries `#token=…`. The app trades it for the login cookie at
`POST /login`, takes the token out of the address before the request goes out, and only then opens the
socket. It happens once per page, from `src/app/_layout.tsx`, because the link points at the root.

`withoutFragment` is the one function for a URL that leaves the page: it drops the fragment and keeps
the query. Every report that serializes a URL goes through it, including
`performance.getEntriesByType("navigation")[0].name`, which keeps the URL from the start of the load and
is not cleaned by `replaceState`.

## Text from elsewhere

A model's answer, a tool's output and a diff are drawn by `src/render`, which never interprets HTML: a
tag comes out as the characters the model wrote, an image becomes a line naming where it lives, and a
link becomes a link only when it is http or https. The renderer builds DOM nodes with `createElement`, so
the native app can host it as a DOM component later.

## Commands

```bash
bun run --cwd apps/remote export   # the web build, into dist/
bun run --cwd apps/remote check    # type check
bun run --cwd apps/remote csp      # load the build through the daemon and fail on any policy violation
```

From the repository root, `bun run app:export`, `bun run app:check` and `bun run csp:check` do the same.
The CI job runs the export and the policy check with a browser; `verify` runs only the type check.

## The policy

The daemon serves every page with a `Content-Security-Policy` that allows only its own scripts, with the
hashes of the page's inline ones. `src/daemon/web.ts` in `packages/remote` owns that policy, and `csp`
checks the export against it in a real browser, so a page that would be blocked fails here and not in
someone's phone.

Part of [pi-harness](https://github.com/felipeadeildo/pi-harness), which brings every piece in one install.

<p align="center">
  <a href="https://adeildo.dev"><img src="https://adeildo.dev/assets/images/cat.svg" width="42" height="42" alt="adeildo.dev"></a><br>
  Brought to you by <a href="https://adeildo.dev">adeildo.dev</a>
</p>
