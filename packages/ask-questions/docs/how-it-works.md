# How the questions work

The [README](../README.md) covers answering. This page covers the rest.

## While the model is still writing

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

## When it closes on its own

If the call never runs, the dialog closes as cancelled. That happens when you stop the model, when the reply ends early, or when the questions are broken. A question that you can see never disappears while the model writes.

## Several picks

`Space` ticks an option, and `Enter` confirms. A tick counts as an answer even if you leave the question with the arrows.

## Your own words

The last row, **Type something.**, opens an editor in the panel. `Shift+Enter` starts a new line. When several picks are allowed, what you type goes along with the options you ticked.

## Before it sends

The review tab lists every question with your answer under it:

- `✓` before a pick
- `✎` before your own words
- `note` before a note
- `○ not answered` for a question you skipped

`Enter` sends the answers anyway, and the model learns which questions you skipped.

<!-- docs:ask-questions/review -->

<p align="center">
  <img src="https://raw.githubusercontent.com/felipeadeildo/pi-harness/main/packages/ask-questions/assets/review.png" alt="The review tab: every question with its answer, before submitting." width="860">
  <br>
  <img src="https://raw.githubusercontent.com/felipeadeildo/pi-harness/main/packages/ask-questions/assets/transcript.png" alt="An answered ask_questions call in the chat: each question with the picked option, a note under it, a note on an option not picked, and an answer in quotes." width="860">
  <br>
  <em>Every answer on one tab before it goes, then the whole call in the chat.</em>
</p>

<!-- /docs -->

## In the chat

While the model writes the questions, the chat shows them as they arrive. Once the dialog opens, the call in the chat shrinks to one line. After you answer, the call shows your answers like the review tab, and `Ctrl+O` shows the questions in full.

The dialog sits in the flow of the screen, so a tall dialog scrolls with the terminal. Over RPC, in an editor plugin or in an ACP client, the questions go one at a time through the host's own dialogs, without previews or notes. With no interface at all, the model never sees the tool.

## The answer in the session

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

[`@adeildo/pi-ask-permission`](../../ask-permission) draws its dialog with this package, so the permission ask and the model's questions use the same keys and keep the same notes. Any package can do the same through the kit:

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
