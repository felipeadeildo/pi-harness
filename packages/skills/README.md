<h1 align="center">@adeildo/pi-skills</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/@adeildo/pi-skills"><img src="https://img.shields.io/npm/v/@adeildo/pi-skills" alt="npm"></a>
  <a href="https://pi.dev"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Ffelipeadeildo%2Fpi-harness%2Fmain%2Fpackage.json&query=%24.devDependencies%5B%22%40earendil-works%2Fpi-coding-agent%22%5D&label=pi%20SDK&color=6E56CF" alt="pi SDK"></a>
</p>

Pi expands `/skill:name` only at the start of a message, and only one skill per message. With this package, you call your skills from anywhere in a message, several at once. The model reads each skill in full, and the chat shows a small chip where you typed it.

<p align="center"><code>pi install npm:@adeildo/pi-skills</code></p>

## What changes

This package brings no skills of its own. It changes how you call the skills that pi already loaded, from your skill folders or from packages. Any `/skill:name` in the text counts:

```text
use /skill:simplify, then go over the docs with /skill:unslop
```

Before your message, the model gets one block per skill, the same `<skill>` block that pi writes for `/skill:name`. Your text reaches the model as you typed it. In the chat, each reference shows as `[skill] name` on a violet background, like pi's label for a folded skill. The blocks stay folded until you press `Ctrl+O`, which expands tool output and shows them in full.

A reference counts when it names a skill that pi loaded and comes after a space, the start of a line or an opening bracket. Inside backticks, it stays plain text.

## Typing a reference

A `/` after the start of the message opens a list of your skills, which narrows as you type, like pi's palette does at the start. Picking one writes `/skill:name` and a space. The list opens on `/` in the editor of [`@adeildo/pi-look`](../look), which also colors each reference while you type. In any other editor, press `Tab` after the `/` to open it.

At the start of the message, `/` still opens pi's own palette, with the commands and the skills.

## The system prompt

Pi writes every skill with its description into the system prompt, which costs every request around a hundred tokens per skill. With this package the prompt says only where your skills are, and the model reads one when you call it or ask it to find one. To give the model the full list again, so it picks a skill on its own, turn on **List every skill** in the settings, or set `skills.list` to `true`.

## Notes

- A message that starts with `/skill:` goes out with a space before it, so pi does not expand that skill a second time. The chat does not show the space.
- While the model works, the skills wait in the queue with the message, as a steer or a follow-up.
- If pi cannot read a skill file, the message goes without that skill, and a warning says why.

<!-- docs:footer -->

<p align="center">
  <a href="https://adeildo.dev"><img src="https://adeildo.dev/assets/images/cat.svg" width="42" height="42" alt="adeildo.dev"></a><br>
  <a href="https://github.com/felipeadeildo/pi-harness">pi-harness</a> is made by <a href="https://adeildo.dev">adeildo.dev</a>
</p>

<!-- /docs -->
