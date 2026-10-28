<h1 align="center">@adeildo/pi-compact</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/@adeildo/pi-compact"><img src="https://img.shields.io/npm/v/@adeildo/pi-compact" alt="npm"></a>
  <a href="https://pi.dev"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Ffelipeadeildo%2Fpi-harness%2Fmain%2Fpackage.json&query=%24.devDependencies%5B%22%40earendil-works%2Fpi-coding-agent%22%5D&label=pi%20SDK&color=6E56CF" alt="pi SDK"></a>
</p>

In a long session, every request sends the whole context again, and most of it is old tool output that the agent no longer needs. This package hides that old output and keeps what matters: your words, the agent's words and the decisions. On a week of real sessions, it cut the cost by about a third.

<p align="center"><code>pi install npm:@adeildo/pi-compact</code></p>

## What it does

When a run ends with more than 150k tokens of context, each tool output older than the last 10 turns becomes one line that names its call:

```text
Output hidden to save context, about 4.2k tokens. It came from: read src/view.ts. Run it again if you need it.
```

- Your messages, the agent's words, errors and the last 10 turns stay whole.
- After a prune, the agent gets its board back, so it keeps track of its work.
- When pi compacts anyway, the board and your last words go on top of the summary unchanged.

Each prune leaves a line in the chat with what it saved, and `Ctrl+O` lists the calls it hid.

<!-- docs:compact/prune -->

<p align="center">
  <img src="https://raw.githubusercontent.com/felipeadeildo/pi-harness/main/packages/compact/assets/prune.png" alt="After a tool call, the prune's line: 181 old tool outputs hidden, 705k to 250k tokens, and below it what the next request pays to rewrite the cache and in how many requests that pays back. Then pi's cache miss notice for that rewrite." width="860">
  <br>
  <em>A prune's line, and the one cache rewrite it costs on the next request.</em>
</p>

<!-- /docs -->

## Commands and settings

`/prune` hides old output when the run ends, whatever the size of the context.

These are on the Compact tab of `Alt+S`, and stored under `compact` in `~/.pi/agent/extensions/pi-harness/settings.json`.

| Setting                 | Default  | What it does                                                                                             |
| ----------------------- | -------- | -------------------------------------------------------------------------------------------------------- |
| Hide old tool output    | on       | Turns the prune on                                                                                       |
| On Anthropic's side     | off      | On Anthropic models, Anthropic clears old output instead of the prune, and the agent keeps its thinking  |
| Above                   | `150000` | How many tokens of context a run must end with to prune                                                  |
| Write it from the board | on       | Puts the board on top of pi's summary, written on the model below. When off, pi uses the session's model |
| Model                   | `auto`   | The model that writes the summary. `auto` picks the cheapest one of the session's provider               |

The tab also shows what this session's prunes freed, and how many hidden outputs the agent had to run again. A high share means the prune hides output that the agent still needs.

[How it works](docs/how-it-works.md) explains when a prune runs, why it works this way, Anthropic's own clearing, and how it was measured.

<!-- docs:footer -->

<p align="center">
  <a href="https://adeildo.dev"><img src="https://adeildo.dev/assets/images/cat.svg" width="42" height="42" alt="adeildo.dev"></a><br>
  <a href="https://github.com/felipeadeildo/pi-harness">pi-harness</a> is made by <a href="https://adeildo.dev">adeildo.dev</a>
</p>

<!-- /docs -->
