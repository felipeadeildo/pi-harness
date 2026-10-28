# How the look works

The [README](../README.md) covers what you see. This page covers the details.

## The boxes

Every command gets its own box, so you see it before it runs:

- The top line has the tool's name.
- Under it come the command, and who let it run and why.
- A line separates the command from what it printed.
- The bottom line says how it went and how long it took. A command that still runs says `running`.

For an `edit` or a `write`, the box shows the diff. The line numbers sit on the left, and only the words that changed get a light background. While the model is still writing the call, the box shows what has arrived so far, with a cursor at the end.

`Alt+O` opens the tool output of the session in a frame that you can scroll, one call at a time, newest first. `Ctrl+O` opens every call in the transcript at once.

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

## Your theme

The look never names a color. Every piece uses a theme token, so it follows whatever theme pi runs. The [reference](reference.md#colours) lists the token for each piece.

<!-- docs:footer -->

<p align="center">
  <a href="https://adeildo.dev"><img src="https://adeildo.dev/assets/images/cat.svg" width="42" height="42" alt="adeildo.dev"></a><br>
  <a href="https://github.com/felipeadeildo/pi-harness">pi-harness</a> is made by <a href="https://adeildo.dev">adeildo.dev</a>
</p>

<!-- /docs -->
