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

The options sit on the left, one per line. The panel on the right shows the option under the cursor: first what it means, then what it looks like.

The panel is as tall as the tallest option, so the dialog keeps its size while you move. To scroll a long preview, use `Shift+↑` `Shift+↓` or the mouse wheel. Under 100 columns, the panel moves below the options.

When the model asks several questions, each one gets a tab:

- `●` marks the question you are on.
- `✓` marks a question you answered.
- `submit` turns green once every question has an answer.

| Key                 | What it does                                                               |
| ------------------- | -------------------------------------------------------------------------- |
| `↑` `↓`, a number   | Move between the options                                                   |
| `Enter`             | Choose the option. When several picks are allowed, confirm the ticked ones |
| `Space`             | Tick an option, when several picks are allowed                             |
| `Tab`               | Write a note on the option under the cursor                                |
| `←` `→`             | Go to another question, or to `submit`                                     |
| `Shift+↑` `Shift+↓` | Scroll a long preview. `PgUp` `PgDn` work too, outside fullscreen          |
| `Esc`               | Close without answering. In the typed row or in a note, step back          |

### While the model is still writing

The dialog opens as soon as the model has written the first question. You can answer it while the model writes the rest.

- An option that is complete can be picked right away.
- The option being written shows in a quiet color, with a cursor at its end.
- A spinner on a tab means that the model is still writing that question.

`submit` stays locked until the whole call has arrived. If you already answered everything, the dialog moves to `submit` on its own when the call is complete.

<!-- docs:ask-questions/writing -->

<p align="center">
  <img src="https://raw.githubusercontent.com/felipeadeildo/pi-harness/main/packages/ask-questions/assets/writing.png" alt="The ask_questions call on one line in the chat while the model writes it, and under it the open dialog. The first question is answered. A spinner turns on the tab of the second. Its first option can be picked already, and the next one arrives in a quiet color with a cursor at the end of its label." width="860">
  <br>
  <em>The dialog opens while the model still writes the call, so you answer the first question as the second arrives.</em>
</p>

<!-- /docs -->

### When it closes on its own

If the call never runs, the dialog closes as cancelled. That happens when you stop the model, when the reply ends early, or when the questions are broken. A question that you can see never disappears while the model writes.

## Answering

### Notes

`Tab` writes a note on the option under the cursor, whether you pick it or not. The option shows a `›` while it has a note.

The model reads the note with your answer. "Tree, but too long with five accounts" tells it more than the pick alone.

### Several picks

`Space` ticks an option, and `Enter` confirms. A tick counts as an answer even if you leave the question with the arrows.

### Your own words

The last row, **Type something.**, opens an editor in the panel. `Shift+Enter` starts a new line. When several picks are allowed, what you type goes along with the options you ticked.

### Before it sends

The review tab lists every question with your answer under it:

- `✓` before a pick
- `✎` before your own words
- `note` before a note
- `○ not answered` for a question you skipped

`Enter` sends the answers anyway, and the model learns which questions you skipped.

## In the chat

While the model writes the questions, the chat shows them as they arrive. Once the dialog opens, the call in the chat shrinks to one line. After you answer, the call shows your answers like the review tab, and `Ctrl+O` shows the questions in full.

The dialog sits in the flow of the screen, so a tall dialog scrolls with the terminal. Over RPC, in an editor plugin or in an ACP client, the questions go one at a time through the host's own dialogs, without previews or notes. With no interface at all, the model never sees the tool.

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

A few details:

- A question can set `typed: false` to leave out the row for your own words, as the permission ask does. The model's tool always has that row.
- Check `canAsk` first: with nothing to draw the dialog, `askQuestions` would wait forever.
- The dialog always answers, even when it fails. Then the answer carries the error.
- The model's tool asks the same way. So your phone, through the remote, sees the model's questions too, and the first answer wins.
- Pass `signal` to give up on a question, and `ctx` to write `ask.opened` and `ask.closed` to the session's log.

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
