# @adeildo/pi-statusline

One footer for [Pi](https://pi.dev), with everything I want to see in it.

```
42 tok/s · 320ms · 2m 17s · 22.5M (U 427k + R 22.0M) · 66k · $0.02/M
~/Projects/pi-harness · main │ ghost · v1.4.2 │ 43.1% ▓▓▓░░░░░ 431k/1.0M
anthropic │ Opus 5.5 · high │ ↑2.4k · ↓347 · R83.0M · $0.139 · avg 12 tok/s
auto · anywhere
```

The first line is the answer being written right now: its speed, how long the first token took, how long it has been going, what it has read so far with the cache breakdown, what it has written, and what it costs per million tokens. When nothing is running it stays there, so the last answer is always readable.

The three speeds are different things on purpose. `42 tok/s` is this answer, live. `avg 12 tok/s` is the whole session: output tokens over the time the model actually spent writing, which excludes the time tools and I take. `$0.02/M` is what a million tokens cost in this answer, which is the number that says whether a model is cheap.

Each finished answer leaves a small entry in the session with its duration and time to the first token. Pi records usage without a duration, so this is where the session speed comes from after a resume, and it is the same data the usage ledger will read later.

The third line is what the other packages report through `setStatus`, so anything installed next to this one shows up there without knowing about it.

## What each piece is

| Piece                      | Where it comes from                                                                                      |
| -------------------------- | -------------------------------------------------------------------------------------------------------- |
| `~/Projects/pi-harness`    | The working folder, with the home directory as `~`, cut from the left when it is long                    |
| `main`                     | The git branch, from pi's footer data, updated when it changes                                           |
| `ghost`                    | The machine, so a line pasted into a chat still says which one it came from                              |
| `v1.4.2`                   | The pi version, so an issue report says which one it was                                                 |
| `43.1% ▓▓▓░░░░░ 431k/1.0M` | How full the context is, the gauge, and the tokens over the window                                       |
| `anthropic`                | The provider serving the turn                                                                            |
| `Opus 5.5 · high`          | The model and the thinking level                                                                         |
| `42 tok/s`                 | Output tokens per second, measured from the first piece of the answer to the last                        |
| `320ms`                    | Time to the first token                                                                                  |
| `↑2.4k ↓347`               | Input and output tokens for the whole session                                                            |
| `R83.0M`                   | Tokens read from the cache                                                                               |
| `cache 99.9%`              | How much of the last prompt came from the cache                                                          |
| `$0.139`                   | What the session cost. On a subscription it says `(sub)`, because that figure is what it would have cost |
| `2m 17s`                   | How long the answer running right now has been going                                                     |

## Settings

They live in the shared file, `~/.pi/agent/extensions/pi-harness/settings.json`, under `statusline.`.

| Key          | Default  | Does                                                                        |
| ------------ | -------- | --------------------------------------------------------------------------- |
| `preset`     | `"full"` | `full` draws every piece on three lines, `compact` on two, `minimal` on one |
| `separator`  | `"bar"`  | `bar` draws `│` between groups, `dot` and `slash` use `·` and `/`           |
| `pathLength` | `40`     | Longest the folder may get before it is shortened. `0` keeps all of it      |
| `statuses`   | `true`   | Show what the other packages report                                         |
| `gauge`      | `true`   | Draw the context as a bar next to the percentage                            |
| `icons`      | `false`  | A glyph before some of the pieces, for a font that has them                 |

The preset and the length are also read from a project, once pi trusts it, so a repository can ask for the compact line without touching your global settings.

## How it stays out of the way

When the terminal is narrow, groups leave the line one at a time, in a fixed order: the statuses of other packages first, then the folder, what the session spent, the context, the speed, the provider, and the model last. A line never goes empty: the last group stays and is cut, because a shortened model name says more than a blank footer.

Time to the first token and tokens per second come from the message events, since pi records usage without a duration. Nothing is cached between renders, so a theme change or a resize needs no special case.

## Credit

The pieces are the ones [pi-open-tui](https://github.com/OldSuns/pi-open-tui) puts in my footer today, plus the two it lacks, tokens per second and time to the first token. [oh-my-pi](https://github.com/can1357/oh-my-pi) is where the segment-with-presets shape comes from.

## License

[MIT](LICENSE)
