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

<!-- docs:look/call -->

<p align="center">
  <img src="https://raw.githubusercontent.com/felipeadeildo/pi-harness/main/packages/look/assets/call.png" alt="Three commands, each in its own box: a bash command with the reason it was allowed and the time it took, a file read, and a command still running." width="860">
  <br>
  <img src="https://raw.githubusercontent.com/felipeadeildo/pi-harness/main/packages/look/assets/settings.png" alt="The settings screen in a frame, titled Settings. The Look tab holds Appearance, Your messages and What is on screen, with Editor frame selected. Under the list, the preview draws the editor's rounded frame with main on the top edge, the folder on the right, the model on the bottom edge and the context on the right. Below, the setting's name and default, and the keys along the bottom edge." width="860">
  <br>
  <em>Every command in a box, and a setting shown before you keep it.</em>
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

Every command gets its own box, so you see it before it runs:

- The top line has the tool's name.
- Under it come the command, and who let it run and why.
- A line separates the command from what it printed.
- The bottom line says how it went and how long it took. A command that still runs says `running`.

For an `edit` or a `write`, the box shows the diff. The line numbers sit on the left, and only the words that changed get a light background. While the model is still writing the call, the box shows what has arrived so far, with a cursor at the end.

`Alt+O` opens the tool output of the session in a frame that you can scroll, one call at a time, newest first. `Ctrl+O` opens every call in the transcript at once.

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

The editor's border starts with this session's name. It also shows the branch, the folder, the permission mode, the model with an effort meter, and how full the context is. The border warms up as the model thinks harder, and it takes the shell's color in bash mode.

Instead of "Working", the spinner says what the model is doing: `waiting`, `thinking`, `writing`, `drafting bash` or `running bash`.

Your messages sit in a frame named `you`, like the tool calls. `look.userFrame` turns this off.

The footer is about the session: the cost, the tokens sent and received, how much came from the cache, the average speeds, and how much of your plan is left, with when it resets.

## Another session

From the `Alt+G` panel or the remote, you can open another session over the whole screen. You see its transcript with the same boxes as yours, and an editor box with its folder, machine and model. The top edge says `live` while the session runs and `ended` once it closes. `Alt+G` or `Esc` takes you back.

<!-- docs:look/view -->

<p align="center">
  <img src="https://raw.githubusercontent.com/felipeadeildo/pi-harness/main/packages/look/assets/view.png" alt="A session with no name yet, shown as new and the end of its id, on the machine server, drawn over the whole screen in one frame with live on the right of its top edge. Its last question and the answer sit above an editor box whose edges carry the session's title, its folder, its machine and its model, and whose only line says the session is read only. The bottom edge says alt+g goes back." width="860">
  <br>
  <em>Another session over the screen, read from its file as it grows.</em>
</p>

<!-- /docs -->

## Nothing jumps around

The numbers change on every frame, and the screen must not move with them.

- Every number sits in a cell of fixed width, so `  17` and `2.8k` take the same room.
- A value that nobody knows yet shows as `–`, instead of appearing later in the middle of the line.
- The working time counts like a stopwatch: `0:59`, then `1:00`.
- An estimate is drawn in a quieter color, so you know it is one.
- The strip and the footer keep their line from the start, so the editor does not jump when the first answer arrives.

## Details

- A tool from an MCP server shows its server and tool, instead of `mcp__server__tool`.
- A tool that brings no drawing of its own gets the same box, with its name and arguments on top.
- Pi's own entries use the same frames: compactions and branch summaries under `π`, skills, and `!` commands.
- The mark of a long phase moves: a clock while a call runs, an hourglass while it waits on you, and a spinner while the model writes it. The mark stops when the call ends.
- The π on the start card rises from its feet once per launch. The harness sets pi's `quietStartup` to `header`, so pi's list of what it loaded stays out of the way.
- Pi records usage without a duration, so each answer leaves a small entry with its time to the first token and its writing time. That keeps the averages right after you resume a session.

## Your theme and settings

The look never names a color. Every piece uses a theme token, so it follows whatever theme pi runs. The [reference](docs/reference.md#colours) lists the token for each piece.

`Alt+S` opens the settings on the Look tab. You choose the icons (Nerd Font, Unicode or ASCII, to match your terminal's font), the style of the editor's frame, and whether your messages sit in a frame. Each choice shows a preview before you keep it. The [reference](docs/reference.md#settings) lists every setting.

The framed editor comes from [pi-open-tui](https://github.com/OldSuns/pi-open-tui), which this package replaces. The segments with priorities come from [oh-my-pi](https://github.com/can1357/oh-my-pi).

<!-- docs:footer -->

<p align="center">
  <a href="https://adeildo.dev"><img src="https://adeildo.dev/assets/images/cat.svg" width="42" height="42" alt="adeildo.dev"></a><br>
  <a href="https://github.com/felipeadeildo/pi-harness">pi-harness</a> is made by <a href="https://adeildo.dev">adeildo.dev</a>
</p>

<!-- /docs -->
