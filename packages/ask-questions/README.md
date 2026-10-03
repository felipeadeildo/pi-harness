# @adeildo/pi-ask-questions

[![npm](https://img.shields.io/npm/v/@adeildo/pi-ask-questions)](https://www.npmjs.com/package/@adeildo/pi-ask-questions)

The model in [Pi](https://pi.dev) asks instead of guessing. Every question comes with options, a live preview of what each one leads to, a note on any of them, and a row for your own answer.

```bash
pi install npm:@adeildo/pi-ask-questions
```

It also comes in [`@adeildo/pi-harness`](../harness), with the rest of the pieces.

## The dialog

<!-- docs:ask-questions/preview -->

<p align="center">
  <img src="https://raw.githubusercontent.com/felipeadeildo/pi-harness/main/packages/ask-questions/assets/preview.png" alt="The question dialog: two questions as tabs, the options on the left, and on the right the description and the preview of the focused option." width="860">
  <br>
  <em>Two questions as tabs, and the preview of the focused option.</em>
</p>

<!-- /docs -->

The options sit on the left, one line each. The panel on the right shows the focused option: what it means, then what it looks like. The panel is as tall as the tallest option of the question, so the dialog keeps its size while you move. A preview longer than the panel scrolls with `pgup` and `pgdn`.

Several questions become tabs. `●` is where you are, `✓` is an answered question, and `submit` turns green once every question has an answer. Under 100 columns the panel moves below the options.

| Key               | Does                                                                   |
| ----------------- | ---------------------------------------------------------------------- |
| `↑` `↓`, a number | Move between the options                                               |
| `enter`           | Choose the option. With several picks allowed, confirm the ones ticked |
| `space`           | Tick an option, when several can be picked                             |
| `tab`             | Write a note on the focused option                                     |
| `←` `→`           | Go to another question, or to `submit`                                 |
| `pgup` `pgdn`     | Scroll a long preview                                                  |
| `esc`             | Close without answering. On the typed row or in a note, step back      |

## Notes

`tab` writes a note on the focused option, picked or not. You write it in the panel, where there is room, and it stays there under the description. The option gets a `›` while it has a note. It goes back to the model with your answer. "Tree, but too long with five accounts" tells the model more than the pick alone.

## Several picks

<!-- docs:ask-questions/multi -->

<p align="center">
  <img src="https://raw.githubusercontent.com/felipeadeildo/pi-harness/main/packages/ask-questions/assets/multi.png" alt="A question that takes several answers, with two of its three options checked." width="860">
  <br>
  <em>A question that takes several answers.</em>
</p>

<!-- /docs -->

`space` ticks and `enter` confirms. A tick counts as an answer even if you leave the question with the arrows.

## Your own words

The last row, **Type something.**, opens an editor in the panel. `shift+enter` breaks a line. With several picks allowed, what you type goes along with the options you ticked.

## Before it sends

<!-- docs:ask-questions/review -->

<p align="center">
  <img src="https://raw.githubusercontent.com/felipeadeildo/pi-harness/main/packages/ask-questions/assets/review.png" alt="The review tab: every question with its answer, before submitting." width="860">
  <br>
  <em>Every answer on one tab, before it goes to the model.</em>
</p>

<!-- /docs -->

The review tab lists what you said and names what is still blank. `enter` sends it anyway, and the model is told which questions were left unanswered.

Pi draws the dialog in the flow of the screen, like the permission dialog, so a tall dialog scrolls with the terminal and the chat above it stays in the scrollback. Over RPC, in an editor plugin or an ACP client, the questions go one at a time through the host's own select and input dialogs, without previews or notes. With no UI at all, the model never sees the tool.

## What the model reads

```text
The user answered:
- Layout: "Which layout should the accounts section use?" → "Tree (Recommended)"
  note on "Tree (Recommended)": fits how I think
  note on "Flat list" (not picked): too long with five accounts
Continue with these answers in mind.
```

The structured answer is the tool result's `details`, so the session stores it next to the call that asked it, on the same branch.

```ts
interface Answer {
	question: string;
	header: string;
	picked: string[];
	typed?: string;
	notes: { option: string; note: string }[];
}
```

## Ask from another package

[`@adeildo/pi-ask-permission`](../ask-permission) draws its dialog with this one, so the permission ask and the model's questions share the same keys and notes. Any package can do the same through the kit:

```ts
import { askQuestions, canAsk } from "@adeildo/pi-kit";

if (canAsk(scope.events)) {
	const result = await askQuestions(scope.events, questions);
}
```

A question can set `typed: false` to leave out the row for your own words, as the permission ask does. The model's tool always has the row.

`canAsk` is a synchronous probe. With nobody to draw the dialog, `askQuestions` would never settle, so check first. The provider always answers, even when the dialog fails, and the answer carries the error.

## Settings

On the **Questions** tab of `Alt+S`, stored under `questions` in `~/.pi/agent/extensions/pi-harness/settings.json`:

| Setting             | Default | Does                                                                                           |
| ------------------- | ------- | ---------------------------------------------------------------------------------------------- |
| When and how to ask | empty   | Your own words for the model, added to the tool's guidelines. Say when to ask, or what to show |
| Ring the bell       | on      | The terminal bell rings when the questions start waiting for you                               |

## Coming from rpiv-ask-user-question

The tool is called `ask_questions` and takes the same parameters as `ask_user_question`. Remove the other package, or the model gets two tools that do the same thing:

```bash
pi remove npm:@juicesharp/rpiv-ask-user-question
```

What works differently: a note belongs to an option and not to the question, there is no note for the whole questionnaire, the dialog scrolls with the terminal so there is no key to fold it, a multi-select option can have a preview, the settings are on `Alt+S`, and the interface is English only.

## Credits

The schema, the validation, the preview layout and the RPC fallback are ported from [`rpiv-ask-user-question`](https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-ask-user-question) by [juicesharp](https://github.com/juicesharp), under the MIT license. The dialog is new.

## License

[MIT](LICENSE)
