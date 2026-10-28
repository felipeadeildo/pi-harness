<h1 align="center">@adeildo/pi-remote</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/@adeildo/pi-remote"><img src="https://img.shields.io/npm/v/@adeildo/pi-remote" alt="npm"></a>
  <a href="https://pi.dev"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Ffelipeadeildo%2Fpi-harness%2Fmain%2Fpackage.json&query=%24.devDependencies%5B%22%40earendil-works%2Fpi-coding-agent%22%5D&label=pi%20SDK&color=6E56CF" alt="pi SDK"></a>
</p>

When an agent needs a decision, you are not always at the desk, and the run waits until you come back. With this package, every pi session on every machine of yours opens in a browser, and your phone reaches the same page. You read the session as it streams, approve a command, answer a question and send the next message. Whichever screen answers first wins, and the other one closes its dialog.

<p align="center"><code>pi install npm:@adeildo/pi-remote</code></p>

<p align="center">or <code>@adeildo/pi-harness</code>, which brings it. Then type <code>/remote</code> in pi.</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/felipeadeildo/pi-harness/main/packages/remote/assets/phones.png" alt="Four phone screens of the remote page. The session list, with one session waiting on you to approve a bun test command. The permission ask on the phone, with yes, always yes and no. The session after the approval: the request, the board card, the test run with 3 passing tests, and the answer. A question from the model about where the change should go, with a pull request recommended." width="860">
  <br>
  <em>From the left: the session list, a command waiting for your approval, the session after you approved it, and a question from the model.</em>
</p>

## Opening it

- **On this machine.** `/remote` prints a link and opens it. The link works once, for one minute. `pi-remote open` does the same from a shell.
- **From your phone.** If your machines are on a [Tailscale](https://tailscale.com) tailnet, open the address that `/remote` prints, such as `http://100.101.102.103:7878/`. A device of yours signs in with no link and no token, because Tailscale says it is yours.
- **Your other machines.** Every machine of yours that runs pi shows up on the same page, with its sessions. The **Machines** page lists each one with its version, and the ones that stopped answering.

Agents on different machines can also share a room, like two terminals in one folder.

## Commands

You never start the daemon by hand: pi starts it when you open a session, and it exits after five minutes without sessions.

| Command                 | What it does                                                               |
| ----------------------- | -------------------------------------------------------------------------- |
| `pi-remote open`        | Prints the link and opens it with `$BROWSER` or the system's opener        |
| `pi-remote serve`       | Runs the daemon in the foreground, and it never exits for being idle       |
| `pi-remote serve --dev` | Runs it from the sources under `bun --watch`, so saving a file restarts it |
| `pi-remote --version`   | Prints the version the launcher points at                                  |

## Learn more

- [How it works](docs/how-it-works.md): the daemon, the routes for anyone writing a client, the page, and security.
- [docs/remote.md](../../docs/remote.md): why it is built this way, and how the pieces fit.

<!-- docs:footer -->

<p align="center">
  <a href="https://adeildo.dev"><img src="https://adeildo.dev/assets/images/cat.svg" width="42" height="42" alt="adeildo.dev"></a><br>
  <a href="https://github.com/felipeadeildo/pi-harness">pi-harness</a> is made by <a href="https://adeildo.dev">adeildo.dev</a>
</p>

<!-- /docs -->
