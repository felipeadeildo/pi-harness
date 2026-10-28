<h1 align="center">@adeildo/pi-ask-questions</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/@adeildo/pi-ask-questions"><img src="https://img.shields.io/npm/v/@adeildo/pi-ask-questions" alt="npm"></a>
  <a href="https://pi.dev"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Ffelipeadeildo%2Fpi-harness%2Fmain%2Fpackage.json&query=%24.devDependencies%5B%22%40earendil-works%2Fpi-coding-agent%22%5D&label=pi%20SDK&color=6E56CF" alt="pi SDK"></a>
</p>

When the model lacks something that only you know, it guesses, and you find out later. This package gives the model a tool to ask you instead. Each question comes with options, a preview of what each option leads to, a note that you can leave on any option, and a row for your own answer.

<p align="center"><code>pi install npm:@adeildo/pi-ask-questions</code></p>

<!-- docs:ask-questions/preview -->

<p align="center">
  <img src="https://raw.githubusercontent.com/felipeadeildo/pi-harness/main/packages/ask-questions/assets/preview.png" alt="The question dialog: two questions as tabs, the options on the left, and on the right the description and the preview of the focused option." width="860">
  <br>
  <img src="https://raw.githubusercontent.com/felipeadeildo/pi-harness/main/packages/ask-questions/assets/multi.png" alt="A question that takes several answers, with two of its three options checked." width="860">
  <br>
  <em>Pick an option and read what it does, or check more than one answer.</em>
</p>

<!-- /docs -->

## Answering

The options are on the left, and the panel on the right shows what the option under the cursor means and what it leads to. When the model asks several questions, each one gets a tab.

| Key                 | What it does                                                               |
| ------------------- | -------------------------------------------------------------------------- |
| `↑` `↓`, a number   | Move between the options                                                   |
| `Enter`             | Choose the option. When several picks are allowed, confirm the ticked ones |
| `Space`             | Tick an option, when several picks are allowed                             |
| `Tab`               | Write a note on the option under the cursor                                |
| `←` `→`             | Go to another question, or to `submit`                                     |
| `Shift+↑` `Shift+↓` | Scroll a long preview. `PgUp` `PgDn` work too, outside fullscreen          |
| `Esc`               | Close without answering. In the typed row or in a note, step back          |

A note is the part that matters most. Press `Tab` on any option, picked or not, and write why. "Too long with five accounts", on an option you turned down, tells the model more than the pick alone.

The last row, **Type something.**, is for an answer in your own words.

## What the model reads

```text
The user answered:
- Layout: "Which layout should the accounts section use?" → "Tree (Recommended)"
  note on "Tree (Recommended)": fits how I think
  note on "Flat list" (not picked): too long with five accounts
Continue with these answers in mind.
```

## Settings

These are on the **Questions** tab of `Alt+S`, and stored under `questions` in `~/.pi/agent/extensions/pi-harness/settings.json`.

| Setting             | Default | What it does                                                                                   |
| ------------------- | ------- | ---------------------------------------------------------------------------------------------- |
| When and how to ask | empty   | Your own words for the model, added to the tool's guidelines. Say when to ask, or what to show |
| Ring the bell       | on      | The terminal bell rings when the questions start to wait for you                               |
| Typing pause        | 1s      | How long after you stop typing in the editor the questions open                                |
| Typing wait cap     | empty   | The longest the questions wait while you type. When empty, they wait as long as you type       |

## Learn more

[How it works](docs/how-it-works.md) covers the dialog while the model is still writing, the review tab, the chat, asking from another package, and moving from `rpiv-ask-user-question`.

<!-- docs:footer -->

<p align="center">
  <a href="https://adeildo.dev"><img src="https://adeildo.dev/assets/images/cat.svg" width="42" height="42" alt="adeildo.dev"></a><br>
  <a href="https://github.com/felipeadeildo/pi-harness">pi-harness</a> is made by <a href="https://adeildo.dev">adeildo.dev</a>
</p>

<!-- /docs -->
