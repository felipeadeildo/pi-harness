<h1 align="center">@adeildo/pi-diagrams</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/@adeildo/pi-diagrams"><img src="https://img.shields.io/npm/v/@adeildo/pi-diagrams" alt="npm"></a>
  <a href="https://pi.dev"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Ffelipeadeildo%2Fpi-harness%2Fmain%2Fpackage.json&query=%24.devDependencies%5B%22%40earendil-works%2Fpi-coding-agent%22%5D&label=pi%20SDK&color=6E56CF" alt="pi SDK"></a>
</p>

Pi draws a ` ```mermaid ` block as Unicode art, and only the kinds of diagram that fit in text. With this package, the block becomes a picture in the terminal, in the colors of your pi theme, and it grows while the model writes it.

<p align="center"><code>pi install npm:@adeildo/pi-diagrams</code></p>

## What changes

[Pele](https://pele.run) lays the diagram out, and [resvg](https://github.com/linebender/resvg) turns it into a picture the size of your terminal's cells, so its labels read at the size of the text around them. Every type of Mermaid 12.1 is drawn, and Pele's own on top: file trees, swimlanes, Ishikawa, Cynefin, event models, agent flows and railroad grammars.

- **While it is written.** Each line the model finishes is drawn as soon as it parses, so the diagram fills in during the answer instead of showing up at the end.
- **In your theme.** Text, lines, borders and accents come from the pi theme, and nodes keep the terminal's own background, as the rest of the harness does.
- **When it cannot be drawn.** A block that does not parse keeps its source, with the reason under it.
- **Without images.** In a terminal that shows no images, or inside tmux, the block is the same Unicode art pi draws.

The model is also told that it can draw, with the list of types and where the syntax of each one is ([pele.run/examples.md](https://pele.run/examples.md)), so it reaches for a diagram when one says more than prose.

## Setting it up

Pi's own Mermaid art runs before every extension, so it would take the blocks first. Turn it off once, in `/settings` (Mermaid rendering: off), or in `~/.pi/agent/settings.json`:

```json
{ "markdown": { "mermaid": "off" } }
```

Until then, the package says so when a session starts. Pictures need a terminal that shows images (Kitty, Ghostty, WezTerm or iTerm2). The labels use your system's monospace font, found with `fc-match` on Linux, Menlo on macOS and Consolas on Windows.

<!-- docs:footer -->

<p align="center">
  <a href="https://adeildo.dev"><img src="https://adeildo.dev/assets/images/cat.svg" width="42" height="42" alt="adeildo.dev"></a><br>
  <a href="https://github.com/felipeadeildo/pi-harness">pi-harness</a> is made by <a href="https://adeildo.dev">adeildo.dev</a>
</p>

<!-- /docs -->
