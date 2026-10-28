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

<!-- docs:ask-questions/review -->

<p align="center">
  <img src="https://raw.githubusercontent.com/felipeadeildo/pi-harness/main/packages/ask-questions/assets/review.png" alt="The review tab: every question with its answer, before submitting." width="860">
  <br>
  <img src="https://raw.githubusercontent.com/felipeadeildo/pi-harness/main/packages/ask-questions/assets/transcript.png" alt="An answered ask_questions call in the chat: each question with the picked option, a note under it, a note on an option not picked, and an answer in quotes." width="860">
  <br>
  <em>Every answer on one tab before it goes, then the whole call in the chat.</em>
</p>

<!-- /docs -->

## The dialog

The options sit on the left, one line each. The panel on the right shows the option under the cursor: what it means, then what it looks like. The panel is as tall as the tallest option, so the dialog keeps its size while you move. When a preview is longer than the panel, you scroll it with `Shift+↑` `Shift+↓` or the mouse wheel, and a bar on its edge shows where you are. A preview drawn with lines or columns keeps its spacing, and moves below the options when it is wider than the panel. Under 100 columns, the panel always sits below the options.

Several questions become tabs. `●` marks where you are, `✓` marks a question you answered, and `submit` turns green once every question has an answer.

The dialog opens as soon as the model has written the first question, without waiting for the rest of the call, so you can answer while the model writes. Every option except the last one of the question being written is complete, so you can pick it, leave a note on it, or move on. The last option arrives in a quiet color, with a cursor at the end of its label, and turns to full color when the model starts the next one. A spinner turns on the tab of that question, and the tab lights up for a moment when the model finishes it. Its **Type something.** row shows up then too. If you answered everything and the model is still writing the last question, the dialog moves to `submit` when the call is complete. `submit` stays locked until then.

<!-- docs:ask-questions/writing -->

<p align="center">
  <img src="https://raw.githubusercontent.com/felipeadeildo/pi-harness/main/packages/ask-questions/assets/writing.png" alt="The ask_questions call on one line in the chat while the model writes it, and under it the open dialog. The first question is answered. A spinner turns on the tab of the second. Its first option can be picked already, and the next one arrives in a quiet color with a cursor at the end of its label." width="860">
  <br>
  <em>The dialog opens while the model still writes the call, so you answer the first question as the second arrives.</em>
</p>

<!-- /docs -->

If the call never runs, the dialog closes as cancelled. That happens when you stop the model, when the reply ends early on an error or at the token limit, when the arguments arrive as broken JSON, or when the questions break a rule of the tool. A piece of the stream that parses to fewer questions than the one before it is skipped, so a question you can see never disappears.

| Key                 | What it does                                                               |
| ------------------- | -------------------------------------------------------------------------- |
| `↑` `↓`, a number   | Move between the options                                                   |
| `Enter`             | Choose the option. When several picks are allowed, confirm the ones ticked |
| `Space`             | Tick an option, when several picks are allowed                             |
| `Tab`               | Write a note on the option under the cursor                                |
| `←` `→`             | Go to another question, or to `submit`                                     |
| `Shift+↑` `Shift+↓` | Scroll a long preview. `PgUp` `PgDn` work too, outside fullscreen          |
| `Esc`               | Close without answering. In the typed row or in a note, step back          |

## Notes

`Tab` writes a note on the option under the cursor, whether you pick that option or not. You write the note in the panel, where there is room, and it stays under the description. The option shows a `›` while it has a note. The note reaches the model with your answer, and "Tree, but too long with five accounts" tells it more than the pick alone.

## Several picks

`Space` ticks an option and `Enter` confirms. A tick counts as an answer even if you leave the question with the arrows.

## Your own words

The last row, **Type something.**, opens an editor in the panel, where `Shift+Enter` starts a new line. When several picks are allowed, what you type goes along with the options you ticked.

## Before it sends

The review tab lists each question with your answer under it: `✓` before a pick, `✎` before your own words, and `note` before a note. A note on an option that you turned down names that option. A question without an answer shows `○ not answered`. `Enter` sends the answers anyway, and the model learns which questions you left unanswered.

## In the chat

Before the dialog opens, the chat shows each question as the model writes it, the last one in full with its options. You see this while you type in the editor, since the dialog waits for you to stop typing. Once the dialog opens, the call in the chat shrinks to one line with the headers. After you answer, the call shows the same blocks as the review tab, and `Ctrl+O` shows the questions in full.

Pi draws the dialog in the flow of the screen, like the permission dialog, so a tall dialog scrolls with the terminal and the chat above it stays in the scrollback. Over RPC, in an editor plugin or in an ACP client, the questions go one at a time through the host's own select and input dialogs, without previews or notes. With no interface at all, the model never sees the tool.

## What the model reads

```text
The user answered:
- Layout: "Which layout should the accounts section use?" → "Tree (Recommended)"
  note on "Tree (Recommended)": fits how I think
  note on "Flat list" (not picked): too long with five accounts
Continue with these answers in mind.
```

The structured answer is in the tool result's `details`, so the session stores it next to the call that asked, on the same branch.

```ts
interface Answer {
	question: string;
	header: string;
	picked: string[];
	typed?: string;
	notes: { option: string; note: string }[];
}
```

## Asking from another package

[`@adeildo/pi-ask-permission`](../ask-permission) draws its dialog with this package, so the permission ask and the model's questions use the same keys and keep the same notes. Any package can do the same through the kit:

```ts
import { askQuestions, canAsk } from "@adeildo/pi-kit";

if (canAsk(scope.events)) {
	const result = await askQuestions(scope.events, questions);
}
```

A question can set `typed: false` to leave out the row for your own words, as the permission ask does. The model's tool always has that row. `canAsk` is a synchronous check, and it exists because `askQuestions` would wait forever if nothing can draw the dialog. The dialog always answers, even when it fails, and then the answer carries the error.

The model's tool asks the same way, with the tool call's id. So anything else that listens for questions, such as your phone through the remote, sees the model's questions too, and the first answer wins. The dialog in the terminal then closes as cancelled. Pass `signal` to give up on a question, and `ctx` to write `ask.opened` and `ask.closed` to the session's log.

## Settings

These are on the **Questions** tab of `Alt+S`, and stored under `questions` in `~/.pi/agent/extensions/pi-harness/settings.json`.

| Setting             | Default | What it does                                                                                   |
| ------------------- | ------- | ---------------------------------------------------------------------------------------------- |
| When and how to ask | empty   | Your own words for the model, added to the tool's guidelines. Say when to ask, or what to show |
| Ring the bell       | on      | The terminal bell rings when the questions start to wait for you                               |
| Typing pause        | 1s      | How long after you stop typing in the editor the questions open                                |
| Typing wait cap     | empty   | The longest the questions wait while you type. When empty, they wait as long as you type       |

## Coming from rpiv-ask-user-question

The tool is called `ask_questions` and takes the same parameters as `ask_user_question`. Remove the other package, or the model gets two tools that do the same thing.

```bash
pi remove npm:@juicesharp/rpiv-ask-user-question
```

What is different here:

- A note belongs to an option, not to the question, and there is no note for the whole set of questions.
- The dialog scrolls with the terminal, so there is no key to fold it.
- An option in a multi-select question can have a preview.
- The settings are in `Alt+S`, and the interface is in English only.

The schema, the validation, the preview layout and the RPC fallback come from [`rpiv-ask-user-question`](https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-ask-user-question) by [juicesharp](https://github.com/juicesharp), under the MIT license. The dialog is new.

<!-- docs:footer -->

<p align="center">
  <a href="https://adeildo.dev"><img src="https://adeildo.dev/assets/images/cat.svg" width="42" height="42" alt="adeildo.dev"></a><br>
  <a href="https://github.com/felipeadeildo/pi-harness">pi-harness</a> is made by <a href="https://adeildo.dev">adeildo.dev</a>
</p>

<!-- /docs -->
