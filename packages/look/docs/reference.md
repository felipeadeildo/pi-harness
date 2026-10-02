# Look reference

Everything the [README](../README.md) leaves out: the colours, the desktop theme, every setting and segment, and how a line fits.

## Colours

The look never names a colour. Every piece names a **theme token**, so it follows whatever theme pi runs: `system`, `dark`, `light`, a JSON of yours, or the desktop theme below. Change the theme and every piece moves with it.

| What                                          | Token                                                       |
| --------------------------------------------- | ----------------------------------------------------------- |
| Folder                                        | `accent`                                                    |
| Branch                                        | `syntaxFunction`                                            |
| Ahead, staged / behind, modified / conflicted | `success` / `warning` / `error`                             |
| Machine, cache                                | `syntaxType`                                                |
| Session name                                  | `mdHeading`                                                 |
| Provider, model icon                          | `syntaxKeyword`                                             |
| Model                                         | `text`, bold                                                |
| Sent `↑`                                      | `mdLink`                                                    |
| Received `↓`, speeds, done                    | `success`                                                   |
| Time to first token, money                    | `syntaxNumber`, then `warning` past $1 and `error` past $10 |
| Context                                       | `success`, `warning` past 70%, `error` past 90%             |
| Effort meter, the π                           | `thinkingMinimal` … `thinkingMax`, one per level            |
| Labels, units, separators                     | `dim`                                                       |
| Editor frame                                  | pi's effort border colour                                   |

Syntax tokens are borrowed on purpose: a theme spends its hues there, so they give the line variety that stays in the theme's family. The table lives in `src/render/paint.ts` as `ROLE_TOKENS`, and a test fails if any entry is ever a colour instead of a token.

### The desktop theme

If you run [DankMaterialShell](https://github.com/AvengeMedia/DankMaterialShell), matugen already made a palette from your wallpaper: the Material roles for dark and light, and sixteen terminal colours, in `~/.cache/DankMaterialShell/dms-colors.json`. The look turns that file into the pi theme `desktop`, writes it to `~/.pi/agent/themes/desktop.json`, and rewrites it whenever the file changes. Pi reloads the active theme from that folder by itself, so a new wallpaper recolours a running pi.

Pi's own `system` theme builds its colours from the terminal's palette. If your terminal already follows matugen, `system` gets close without this, with fewer colours to work from: the sixteen terminal colours instead of the Material roles.

`Switch to it now`, in the Desktop theme section of the settings (`Alt+S`), writes the theme and makes it pi's.

The mapping, from the Material roles and the terminal colours:

| Pi                                 | Desktop                                                                                             |
| ---------------------------------- | --------------------------------------------------------------------------------------------------- |
| `accent`, links, keywords, bullets | `primary`                                                                                           |
| `text`, `muted`, `dim`             | `on_surface`, `on_surface_variant`, `outline`                                                       |
| borders                            | `outline`, `primary`, `outline_variant`                                                             |
| selection, messages, pending tools | the `surface_container` steps                                                                       |
| `success`, `warning`, `error`      | terminal green, terminal yellow, `error`                                                            |
| tool success and error backgrounds | a surface mixed with green or with `error`                                                          |
| headings, functions, custom labels | `tertiary`                                                                                          |
| code, types                        | `secondary`, terminal cyan                                                                          |
| effort ramp, off to max            | `outline_variant`, `outline`, `secondary`, `primary`, `tertiary`, terminal bright red, terminal red |

Material has no success, warning or diff roles, so the terminal colours of that hue stand in. The top of the effort ramp uses the terminal reds on purpose: they keep their meaning whatever the wallpaper, so the frame still reads hot at `xhigh` and `max`.

Another palette source is a new file next to `src/desktop/palette.ts`: a parser into Material roles and terminal colours, and the same mapping does the rest.

## Settings

They live in the file every piece shares, `~/.pi/agent/extensions/pi-harness/settings.json`, under `look.`. The ones marked _project_ are also read from a trusted project.

| Key                 | Default                                                                               | Does                                                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `strip`             | `["elapsed", "last"]`                                                                 | The line above the editor. _project_                                                                                                                             |
| `frame.topLeft`     | `["branch", "session"]`                                                               | After the spinner. _project_                                                                                                                                     |
| `frame.topRight`    | `["path", "host"]`                                                                    | _project_                                                                                                                                                        |
| `frame.bottomLeft`  | `["status:pi-ask-permission:mode", "model", "status:pi-providers:account", "effort"]` | _project_                                                                                                                                                        |
| `frame.bottomRight` | `["context"]`                                                                         | _project_                                                                                                                                                        |
| `below`             | `["cost", "tokens", "cache", "average", "statuses"]`                                  | The line below the editor. _project_                                                                                                                             |
| `labels`            | `true`                                                                                | A short word before each number: `out`, `in`, `ttft`, `wait`, `thought`, `server`, `time`, `ctx`, `cache`. Off is denser, with only the glyphs. _project_        |
| `frame.style`       | `"rounded"`                                                                           | `rounded`, `square`, `heavy`, `line` (pi's two rules, written into), or `off`, which leaves pi's editor alone and moves the frame slots to the footer. _project_ |
| `frame.cursor`      | `"bar"`                                                                               | `block`, `bar` or `underline`. The last two use the terminal's own cursor                                                                                        |
| `header`            | `"card"`                                                                              | `card`, `compact` (two lines) or `off` (pi's own). _project_                                                                                                     |
| `icons`             | `"auto"`                                                                              | `nerd`, `unicode` or `ascii`. Auto uses Nerd Font glyphs locally and plain Unicode over SSH, where the font lives on the other machine                           |
| `separator`         | `"space"`                                                                             | `dot`, `bar`, `slash` or `space`. _project_                                                                                                                      |
| `pathLength`        | `40`                                                                                  | Longest the folder may be before it loses folders from the left. _project_                                                                                       |
| `gaugeCells`        | `8`                                                                                   | Cells in the context gauge. `0` hides it. _project_                                                                                                              |
| `peek`              | `true`                                                                                | The spinner names the state. Off, it says what pi says                                                                                                           |
| `desktop.theme`     | `true`                                                                                | Keep the desktop theme written. Nothing happens without the palette file                                                                                         |
| `desktop.source`    | `"~/.cache/DankMaterialShell/dms-colors.json"`                                        | Where the palette is                                                                                                                                             |

### Segments

Any segment goes in any slot, in the order the slot lists them.

| Id             | Shows                                                                                                 |
| -------------- | ----------------------------------------------------------------------------------------------------- |
| `path`         | The working folder, with home as `~`                                                                  |
| `branch`       | The branch, ahead `↑` and behind `↓`, staged `+`, modified `~`, untracked `?`, conflicts `!`, stashes |
| `host`         | The machine, so a pasted line says where it came from                                                 |
| `session`      | The session name, once it has one                                                                     |
| `version`      | The pi version                                                                                        |
| `clock`        | The time                                                                                              |
| `model`        | `provider/model`                                                                                      |
| `provider`     | The provider on its own                                                                               |
| `effort`       | The effort meter and level. Hidden for models that do not reason                                      |
| `context`      | Context used, the gauge, tokens over the window                                                       |
| `speed`        | This answer's speeds, received `↓` and sent `↑`                                                       |
| `wait`         | Time to the first token                                                                               |
| `server`       | The last call's time from the request leaving to the response headers                                 |
| `elapsed`      | The agent's working time, as a stopwatch, and its calls                                               |
| `last`         | The last finished call: its wait, its thought time and its writing speed                              |
| `request`      | This answer's tokens, with the cache                                                                  |
| `costRate`     | This answer's cost per million tokens                                                                 |
| `cost`         | The session's cost                                                                                    |
| `tokens`       | The session's tokens, with the cache                                                                  |
| `cache`        | The cache hit of the last prompt                                                                      |
| `average`      | The session's average speeds, both ways                                                               |
| `statuses`     | What other packages report through `setStatus`, minus the ones placed on their own                    |
| `status:<key>` | One package's status, by the key it passes to `setStatus`                                             |

A `status:<key>` segment is how a package gets a place of its own. [`@adeildo/pi-ask-permission`](../ask-permission) reports its mode as `pi-ask-permission:mode`, and the mode says what happens to what you type, so by default it sits in the frame next to the model instead of in the footer with everything else.

## How it fits

When a line runs out of room, the least important pieces take their short form first (the folder becomes its last part, the model loses its provider, the effort meter loses its label), and then leave, one at a time. The two sides of a border compete for the same width, so an unimportant piece on the right leaves before an important one on the left. A line never goes empty: the last piece stays and is cut.

The frame is the editor pi already has. Typing, history, autocomplete and every app key stay pi's; the class only changes what the lines look like and shifts mouse clicks by the width of the frame. The spinner is pi's, embedded through pi's own hook, and the working line only speaks through `setWorkingMessage`.
