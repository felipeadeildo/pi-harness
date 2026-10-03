# @adeildo/pi-look

[![npm](https://img.shields.io/npm/v/@adeildo/pi-look)](https://www.npmjs.com/package/@adeildo/pi-look)

[Pi](https://pi.dev)'s start screen, editor, footer and working line, redrawn around the numbers that matter while the agent works. It paints only with the colours of the theme you run, and the screen holds still while the numbers change.

```bash
pi install npm:@adeildo/pi-look
```

It also comes in [`@adeildo/pi-harness`](../harness), with the rest of the pieces.

<!-- docs:look/preview -->

<p align="center">
  <img src="https://raw.githubusercontent.com/felipeadeildo/pi-harness/main/packages/look/assets/preview.png" alt="Pi with the look: the start card, then the strip with the stopwatch and the last call, the framed editor with the branch, the model and the context, and below it the cost, the tokens, the cache and the average speeds." width="860">
  <br>
  <em>The start card, then a prompt halfway through its answer.</em>
</p>

<!-- /docs -->

## What is on the screen

**The start card** says what the session starts with: the model and its effort, the folder and the state of the tree, the machine, how many tools, skills, prompts and extensions loaded, and the keys worth knowing, read from your keybindings.

**The strip above the editor** is calm on purpose. Nothing in it moves while the model streams except the stopwatch.

| Piece                                            | Means                                                                                                                                   |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `0:12  3 calls`                                  | How long the agent has worked on this prompt, and how many calls to the model it made                                                   |
| `last call 1.7s wait  900ms thought  ↓906 tok/s` | The last call that finished: how long the model took to start, how long it thought before writing, and how fast it wrote. Final numbers |

**A tool call** is framed too. The mark of the tool and its name sit on the top rule, the call and its result inside, and the bottom rule closes in the colour of how it went: a check for a call that worked, a cross for one that failed. An MCP tool shows its server and tool rather than `mcp__server__tool`, and the marks follow the icon set you picked. While the call runs there is no bottom rule yet.

**The frame** around the editor carries the branch with its distance and changes, the folder, the permission mode, the model with an effort meter, and the context. The border takes pi's own effort colour, so it warms up as the model thinks harder and turns to the bash colour in shell mode.

**The spinner** names the state instead of saying "Working": `waiting` for the first token, `thinking`, `writing`, `drafting bash` while the model writes the call, `running bash` while it runs.

**The footer** is the session: the cost, tokens sent and received, the cache hit of the last prompt, the average speeds, and last what other packages report, because it changes the most.

## It holds still

Numbers change on every frame and the screen must not move with them.

- Every number sits in a cell of fixed width, so `  17` and `2.8k` take the same room.
- A value not known yet shows as `–` in its cell and does not appear later in the middle of the line.
- The working time is a stopwatch, `0:59` then `1:00`, instead of `59s` then `1m 0s`.
- An estimate is drawn quieter and does not gain a `~`.
- The strip and the footer keep their line from the start, so the editor does not jump when the first answer arrives.

Every finished answer leaves a small entry in the session with its time to first token and writing time, because pi records usage without a duration. That keeps the averages right after a resume.

## Your theme, not ours

The look never names a colour. Every piece names a **theme token**, so it follows whatever theme pi runs: `system`, `dark`, `light`, a JSON of yours, or the desktop theme below. Change the theme and every piece moves with it. The [reference](docs/reference.md#colours) maps each piece to its token.

### The desktop theme

If you run [DankMaterialShell](https://github.com/AvengeMedia/DankMaterialShell), matugen already made a palette from your wallpaper. The look turns it into the pi theme `desktop`, writes it to `~/.pi/agent/themes/desktop.json` and rewrites it when the palette changes. Pi reloads the active theme from that folder by itself, so a new wallpaper recolours a running pi. `Switch to it now`, in the Desktop theme section of the settings (`Alt+S`), writes the theme and makes it pi's.

## Settings

`Alt+S` opens them, on the Look tab. You can reorder and move every piece of the strip, the frame and the footer, pick the frame style, the icons and the separator, and switch off what you do not want. The [reference](docs/reference.md#settings) lists every key and every segment.

## Credit

The framed editor and the idea of writing into its borders come from [pi-open-tui](https://github.com/OldSuns/pi-open-tui), which this replaces. The segments with priorities, and the status line in the editor border, come from [oh-my-pi](https://github.com/can1357/oh-my-pi).

## License

[MIT](LICENSE)
