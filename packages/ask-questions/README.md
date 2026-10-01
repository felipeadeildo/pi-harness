# @adeildo/pi-ask-questions

[![npm](https://img.shields.io/npm/v/@adeildo/pi-ask-questions)](https://www.npmjs.com/package/@adeildo/pi-ask-questions)

Lets the model in [Pi](https://pi.dev) ask you instead of guessing. Each question comes with options, a preview of what each option leads to, and a row for your own answer. You can leave a note on any option, picked or not, and every note goes back with the answer.

```bash
pi install npm:@adeildo/pi-ask-questions
```

It also comes in [`@adeildo/pi-harness`](../harness), with the rest of the pieces.

## The dialog

```text
╭─ questions ─────────────────────────────────────────────────────────────╮
│ Layout   Scope   submit                                                 │
│                                                                         │
│ Which layout should the accounts section use?                           │
│                                                                         │
│ ❯ 1  Tree (Recommended)         ┌──────────────────────────────────────┐ │
│      Provider, then accounts    │ Anthropic                            │ │
│      note fits how I think      │   ● work   active                    │ │
│   2  Flat list                  │   ○ home                             │ │
│      One row per account        │   + add account                      │ │
│   3  Type something.            └──────────────────────────────────────┘ │
│                                                                         │
│ ←→ question   ↑↓ or 1-3 move   enter choose   tab note   esc cancel     │
╰─────────────────────────────────────────────────────────────────────────╯
```

| Key               | Does                                                                              |
| ----------------- | --------------------------------------------------------------------------------- |
| `↑` `↓`, a number | Move between the options                                                          |
| `enter`           | Choose the option. With several picks allowed, confirm the ones ticked            |
| `space`           | Tick an option, when several can be picked                                        |
| `tab`             | Write a note on the focused option, picked or not. `↑` `↓` move to the next one's |
| `←` `→`           | Go to another question, or to the submit tab                                      |
| `esc`             | Close without answering. On the typed row or in a note, step back                 |

The last row, **Type something.**, is an editor for an answer in your own words. `shift+enter` breaks a line. With several picks allowed, what you type goes along with the options you ticked.

With more than one question, answering one opens the next. The submit tab lists what you said and names what is still blank, and `enter` sends it anyway.

Pi draws the dialog in the flow of the screen, like the permission dialog, and not as an overlay on top of the chat. A tall dialog scrolls with the terminal, and the chat above it stays in the scrollback.

Over RPC, in an editor plugin or an ACP client, the questions go one at a time through the host's own select and input dialogs. There's no preview pane and no notes there. With no UI at all, the model never sees the tool.

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

## Settings

On the **Questions** tab of `Alt+S`:

| Setting             | Default | What it does                                                                                          |
| ------------------- | ------- | ----------------------------------------------------------------------------------------------------- |
| When and how to ask | empty   | Your own words for the model, added to the tool's guidelines. Say when it should ask, or what to show |
| Ring the bell       | on      | The terminal bell rings when the questions start waiting for you                                      |

They live under `questions` in `~/.pi/agent/extensions/pi-harness/settings.json`.

## Coming from rpiv-ask-user-question

The tool is called `ask_questions` and takes the same parameters as `ask_user_question`. Remove the other package, or the model gets two tools that do the same thing:

```bash
pi remove npm:@juicesharp/rpiv-ask-user-question
```

These things work differently:

- A note goes on an option instead of on the question, and there's no note for the whole questionnaire.
- The dialog scrolls with the terminal, so there's no key to fold it away.
- A multi-select option can have a preview too.
- The settings are on `Alt+S` instead of `~/.config/rpiv-ask-user-question/config.json`.
- The interface is in English only.

## Credits

The schema, the validation, the preview layout and the RPC fallback are ported from [`rpiv-ask-user-question`](https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-ask-user-question) by [juicesharp](https://github.com/juicesharp), under the MIT license. The dialog is new.

## License

[MIT](LICENSE)
