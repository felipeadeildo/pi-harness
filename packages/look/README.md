<h1 align="center">@adeildo/pi-look</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/@adeildo/pi-look"><img src="https://img.shields.io/npm/v/@adeildo/pi-look" alt="npm"></a>
  <a href="https://pi.dev"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Ffelipeadeildo%2Fpi-harness%2Fmain%2Fpackage.json&query=%24.devDependencies%5B%22%40earendil-works%2Fpi-coding-agent%22%5D&label=pi%20SDK&color=6E56CF" alt="pi SDK"></a>
</p>

While an agent works, you keep checking the same few things: what it is about to run, whether that went well, how long it has been, and what it costs. This package redraws pi's screen around those things. You get a start card, an editor framed with the branch and the model, a box around every command, and a footer with what the session costs.

<p align="center"><code>pi install npm:@adeildo/pi-look</code></p>

<!-- docs:look/preview -->

<p align="center">
  <img src="https://raw.githubusercontent.com/felipeadeildo/pi-harness/main/packages/look/assets/preview.png" alt="Pi with the look: the start card, then the strip with the stopwatch and the last call, the card under way with how many wait, are to do and are done, the framed editor with the branch, the model and the context, and below it the cost, the tokens, the cache and the average speeds." width="860">
  <br>
  <em>The start card, then a prompt halfway through its answer.</em>
</p>

<!-- /docs -->

## The start card

The card shows the π, the folder, the branch, the model, and the name that the rooms and the remote page use for this session. Under them, it lists only what changed or waits on you since your last session in the folder:

- an account that needs you to sign in again
- files in conflict, or a branch behind its remote
- a failed CI run on the branch
- a pull request of yours with changes requested or a new comment
- other agents working in the folder
- a plan past 70% of its limit
- a new version of the harness

On a quiet day, the card says that nothing is new. GitHub is asked in the background, so the card never waits for it. Without `gh`, without a network, or outside GitHub, those lines just stay out.

## Each command in a box

Every command gets its own box, so you see it before it runs: the command, who let it run and why, what it printed, and how long it took. For an edit, the box shows the diff, and only the words that changed get a light background.

<!-- docs:look/call -->

<p align="center">
  <img src="https://raw.githubusercontent.com/felipeadeildo/pi-harness/main/packages/look/assets/call.png" alt="Three commands, each in its own box: a bash command with the reason it was allowed and the time it took, a file read, and a command still running." width="860">
  <br>
  <em>Every command in its own box: what ran, who let it run, the output and the time.</em>
</p>

<!-- /docs -->

`Alt+O` opens the tool output of the session, one call at a time. `Ctrl+O` opens every call in the transcript.

## Above the editor

The strip above the editor stays calm. While the model streams, only the stopwatch moves.

| What you see                                     | What it means                                                                         |
| ------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `0:12  3 calls`                                  | How long the agent has worked on this prompt, and how many calls it made to the model |
| `last call 1.7s wait  900ms thought  ↓906 tok/s` | How long the last call took to start, to think and write, and how fast it wrote       |
| `answered in 0:47  2 calls  $0.31`               | Once the run ends: how long it took, how many calls, and what it cost                 |

On the right, the strip shows the card the agent is working on, and the rooms this session is in:

- Each room shows how this session stands there: `●` takes part, `◐` listens, `○` stepped out.
- After the room come its agents, each with what it is doing: `◆` working, `⚑` waiting on you, `◇` idle.

The messages that you send while the agent works wait above the editor, in a dashed frame. `steer` means the message goes in between the agent's calls, and `next` means it goes after the run.

## The editor and the footer

The editor's border shows this session's name, the branch, the folder, the permission mode, the model and how full the context is. The footer shows what the session cost, the tokens, the cache, the speeds, and how much of your plan is left.

Nothing on the screen jumps around: every number has a fixed width, and a value that nobody knows yet shows as `–` instead of popping in later.

## Settings

`Alt+S` opens them on the Look tab. You choose the icons (Nerd Font, Unicode or ASCII, to match your terminal's font), the style of the editor's frame, and whether your messages sit in a frame. Each choice shows a preview before you keep it.

<!-- docs:look/settings -->

<p align="center">
  <img src="https://raw.githubusercontent.com/felipeadeildo/pi-harness/main/packages/look/assets/settings.png" alt="The settings screen in a frame, titled Settings. The Look tab holds Appearance, Your messages and What is on screen, with Editor frame selected. Under the list, the preview draws the editor's rounded frame with main on the top edge, the folder on the right, the model on the bottom edge and the context on the right. Below, the setting's name and default, and the keys along the bottom edge." width="860">
  <br>
  <em>Change a setting and see the result drawn under the list before you keep it.</em>
</p>

<!-- /docs -->

## Learn more

- [How it works](docs/how-it-works.md): the strip and the footer in detail, another session over the screen, and how the screen holds still.
- [Reference](docs/reference.md): every setting and the theme token behind each color.

The framed editor comes from [pi-open-tui](https://github.com/OldSuns/pi-open-tui), which this package replaces. The segments with priorities come from [oh-my-pi](https://github.com/can1357/oh-my-pi).

<!-- docs:footer -->

<p align="center">
  <a href="https://adeildo.dev"><img src="https://adeildo.dev/assets/images/cat.svg" width="42" height="42" alt="adeildo.dev"></a><br>
  <a href="https://github.com/felipeadeildo/pi-harness">pi-harness</a> is made by <a href="https://adeildo.dev">adeildo.dev</a>
</p>

<!-- /docs -->
