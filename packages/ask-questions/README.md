<h1 align="center">@adeildo/pi-ask-questions</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/@adeildo/pi-ask-questions"><img src="https://img.shields.io/npm/v/@adeildo/pi-ask-questions" alt="npm"></a>
  <a href="https://pi.dev"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Ffelipeadeildo%2Fpi-harness%2Fmain%2Fpackage.json&query=%24.devDependencies%5B%22%40earendil-works%2Fpi-coding-agent%22%5D&label=pi%20SDK&color=6E56CF" alt="pi SDK"></a>
</p>

<p align="center">
  <strong>The model asks instead of guessing.</strong><br>
  Every question comes with options, a preview of what each one leads to, a note you can leave on any of them, and a row for your own answer.
</p>

<p align="center"><code>pi install npm:@adeildo/pi-ask-questions</code></p>

<!-- docs:ask-questions/preview -->

<p align="center">
  <img src="https://raw.githubusercontent.com/felipeadeildo/pi-harness/main/packages/ask-questions/assets/preview.png" alt="The question dialog: two questions as tabs, the options on the left, and on the right the description and the preview of the focused option." width="420">
  <img src="https://raw.githubusercontent.com/felipeadeildo/pi-harness/main/packages/ask-questions/assets/multi.png" alt="A question that takes several answers, with two of its three options checked." width="420">
  <br>
  <em>Pick an option and read what it does, or check more than one answer.</em>
</p>

<!-- /docs -->

<!-- docs:ask-questions/review -->

<p align="center">
  <img src="https://raw.githubusercontent.com/felipeadeildo/pi-harness/main/packages/ask-questions/assets/review.png" alt="The review tab: every question with its answer, before submitting." width="420">
  <img src="https://raw.githubusercontent.com/felipeadeildo/pi-harness/main/packages/ask-questions/assets/transcript.png" alt="An answered ask_questions call in the chat: each question with the picked option, a note under it, a note on an option not picked, and an answer in quotes." width="420">
  <br>
  <em>Every answer on one tab before it goes, then the whole call in the chat.</em>
</p>

<!-- /docs -->

## The dialog

The options sit on the left, one line each. The panel on the right shows the option under the cursor: what it means, then what it looks like. The panel is as tall as the tallest option, so the dialog keeps its size while you move. A preview longer than the panel scrolls with `shift+↑` `shift+↓` or the mouse wheel, with a bar on its edge that shows where you are. A preview drawn with lines or columns keeps its spacing as written, and goes below the options when it is wider than the panel. Under 100 columns the panel always sits below the options.

Several questions become tabs. `●` is where you are, `✓` is a question already answered, and `submit` turns green once every one has an answer.

The dialog opens as soon as the model has written the text of the first question, without waiting for the rest of the call. You answer while the model writes. Every option that has another one after it is whole, so you can pick it, note it, or move on. Only the last option of the question being written waits: it arrives in a quiet color with a cursor blinking at the end of its label, and it comes up to full color the moment the model starts the next one. A spinner turns on the tab of that question, and when the model finishes it, the tab lights up for a moment. Its **Type something.** row shows up then too. If you answered everything and wait on the last question, the dialog moves to `submit` when the call is complete. `submit` stays locked until then.

<!-- docs:ask-questions/writing -->

<p align="center">
  <img src="https://raw.githubusercontent.com/felipeadeildo/pi-harness/main/packages/ask-questions/assets/writing.png" alt="The ask_questions call on one line in the chat while the model writes it, and under it the open dialog. The first question is answered. A spinner turns on the tab of the second. Its first option can be picked already, and the next one arrives in a quiet color with a cursor at the end of its label." width="860">
  <br>
  <em>The dialog opens while the model still writes the call, so you answer the first question as the second arrives.</em>
</p>

<!-- /docs -->

If the call never runs, the dialog closes as cancelled. That happens when you stop the model, when the reply ends early on an error or at the token limit, when the arguments arrive as broken JSON, or when the questions break a rule of the tool. A piece of the stream that parses to fewer questions than the one before is skipped, so a question you can see never disappears.

| Key                 | Does                                                                   |
| ------------------- | ---------------------------------------------------------------------- |
| `↑` `↓`, a number   | Move between the options                                               |
| `enter`             | Choose the option. With several picks allowed, confirm the ones ticked |
| `space`             | Tick an option, when several can be picked                             |
| `tab`               | Write a note on the option under the cursor                            |
| `←` `→`             | Go to another question, or to `submit`                                 |
| `shift+↑` `shift+↓` | Scroll a long preview. `pgup` `pgdn` too, outside fullscreen           |
| `esc`               | Close without answering. On the typed row or in a note, step back      |

## Notes

`tab` writes a note on the option under the cursor, picked or not. You write it in the panel, where there is room, and it stays under the description. The option gets a `›` while it has one. The note reaches the model with your answer, and "Tree, but too long with five accounts" tells it more than the pick alone. With [`@adeildo/pi-board`](../tasks) installed, your picks and notes also count as a message of yours there, so they can settle a decision or approve a task.

## Several picks

`space` ticks and `enter` confirms. A tick counts as an answer even if you leave the question with the arrows.

## Your own words

The last row, **Type something.**, opens an editor in the panel, where `shift+enter` breaks a line. With several picks allowed, what you type goes along with the options you ticked.

## Before it sends

The review tab lists each question with what you said under it: `✓` before a pick, `✎` before your own words, and `note` before a note, which names its option when you turned that option down. A question without an answer shows `○ not answered`. `enter` sends it anyway, and the model is told which questions were left unanswered.

## In the chat

Before the dialog opens, the chat shows each question as the model writes it, the last one in full with its options. You see this while you type in the editor, since the dialog waits for you to stop. Once the dialog opens, the call in the chat shrinks to one line with the headers. After you answer, the call keeps the same blocks as the review tab, and `ctrl+o` shows the questions uncut.

Pi draws this dialog in the flow of the screen, like the permission dialog, so a tall one scrolls with the terminal and the chat above it stays in the scrollback. Over RPC, in an editor plugin or an ACP client, the questions go one at a time through the host's own select and input dialogs, without previews or notes. With no UI at all, the model never sees the tool.

## What the model reads

```text
The user answered:
- Layout: "Which layout should the accounts section use?" → "Tree (Recommended)"
  note on "Tree (Recommended)": fits how I think
  note on "Flat list" (not picked): too long with five accounts
Continue with these answers in mind.
```

The structured answer is the tool result's `details`, so the session stores it next to the call that asked, on the same branch.

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

[`@adeildo/pi-ask-permission`](../ask-permission) draws its dialog with this one, so the permission ask and the model's questions take the same keys and hold the same notes. Any package can do the same through the kit:

```ts
import { askQuestions, canAsk } from "@adeildo/pi-kit";

if (canAsk(scope.events)) {
	const result = await askQuestions(scope.events, questions);
}
```

A question can set `typed: false` to leave out the row for your own words, as the permission ask does. The model's tool always has that row. `canAsk` is a synchronous probe, and it exists because `askQuestions` would never settle with nobody to draw the dialog. The provider always answers, even when the dialog fails, and the answer carries the error.

The model's tool asks the same way, with the tool call's id. So anything else that listens for questions, such as a phone, sees the model's questions too, and the first answer wins. The dialog here then closes as cancelled. Pass `signal` to give up on a question, and `ctx` to write `ask.opened` and `ask.closed` to the session's log.

## Settings

On the **Questions** tab of `Alt+S`, stored under `questions` in `~/.pi/agent/extensions/pi-harness/settings.json`:

| Setting             | Default | Does                                                                                           |
| ------------------- | ------- | ---------------------------------------------------------------------------------------------- |
| When and how to ask | empty   | Your own words for the model, added to the tool's guidelines. Say when to ask, or what to show |
| Ring the bell       | on      | The terminal bell rings when the questions start waiting for you                               |
| Typing pause        | 1s      | How long after you stop typing in the editor the questions open                                |
| Typing wait cap     | empty   | The longest the questions wait while you type. Empty waits for as long as you type             |

## Coming from rpiv-ask-user-question

The tool is called `ask_questions` and takes the same parameters as `ask_user_question`. Remove the other package, or the model gets two tools that do the same thing.

```bash
pi remove npm:@juicesharp/rpiv-ask-user-question
```

What differs: a note belongs to an option and not to the question, there is no note for the whole questionnaire, the dialog scrolls with the terminal so there is no key to fold it, a multi-select option can have a preview, the settings are on `Alt+S`, and the interface is English only.

The schema, the validation, the preview layout and the RPC fallback are ported from [`rpiv-ask-user-question`](https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-ask-user-question) by [juicesharp](https://github.com/juicesharp), under the MIT license. The dialog is new.

Part of [pi-harness](https://github.com/felipeadeildo/pi-harness), which brings every piece in one install.

<p align="center">
  <a href="https://adeildo.dev"><img src="https://adeildo.dev/assets/images/cat.svg" width="42" height="42" alt="adeildo.dev"></a><br>
  Brought to you by <a href="https://adeildo.dev">adeildo.dev</a>
</p>
