<h1 align="center">@adeildo/pi-harness</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/@adeildo/pi-harness"><img src="https://img.shields.io/npm/v/@adeildo/pi-harness" alt="npm"></a>
  <a href="https://pi.dev"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Ffelipeadeildo%2Fpi-harness%2Fmain%2Fpackage.json&query=%24.devDependencies%5B%22%40earendil-works%2Fpi-coding-agent%22%5D&label=pi%20SDK&color=6E56CF" alt="pi SDK"></a>
</p>

<p align="center">
  <strong>Pi runs every command without asking. This makes it ask.</strong><br>
  Every piece of this repository in one install: the permission, the questions, the screen and the Claude plan.
</p>

<p align="center"><code>pi install npm:@adeildo/pi-harness</code></p>

<!-- docs:harness/conversation -->

<p align="center">
  <img src="https://raw.githubusercontent.com/felipeadeildo/pi-harness/main/packages/harness/assets/conversation.png" alt="A session with the look: the start card, a request, the model running the tests, committing and pushing, then the stopwatch, the card under way, the editor and the cost." width="860">
  <br>
  <em>A session: the start card, what you asked, what the model ran, and what it cost.</em>
</p>

<!-- /docs -->

## What comes in it

| Piece                           | What it does                                                                                                                |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| [Permission](../ask-permission) | Asks before a command runs, with a note the model reads. A model answers the easy ones for you                              |
| [Questions](../ask-questions)   | The model asks instead of guessing, with options, a preview of each, a note on any and your own answer                      |
| [Board](#the-board)             | The session's board: what the agent is doing, what waits on you, and what it delivered, written by the agent with a tool    |
| [Compact](../compact)           | Hides old tool output in long sessions to cut what each request costs, and writes pi's compaction summary from the board    |
| [Peers](../peers)               | Agents in the same folder see each other's work, talk in a room, hear what you tell everyone, and split what you ask anyone |
| [Skill calls](../skills)        | Call the skills you already have from anywhere in a message, several at once, shown as chips                                |
| [Look](../look)                 | The start screen, the editor with the branch and the model on its borders, and a box around each command                    |
| [Providers](../providers)       | Bills Anthropic OAuth requests to your Claude plan, and keeps several accounts per provider                                 |
| [Remote](../remote)             | Your sessions in a browser, on this machine or from a phone on your tailnet, with `/remote`                                 |

All of them are on once the package is installed.

> [!WARNING]
> Providers makes Pi introduce itself to Anthropic as Claude Code whenever a request uses an Anthropic OAuth token. Using a subscription from anything other than Claude Code may break Anthropic's terms. Turn it off, as below, if you do not want that. A request with an API key goes out untouched.

## Turning a piece off

Each piece is its own extension in this package, so `pi config` switches off the one you do not want, globally or for one project. The settings file has a switch per feature too, read on the next `/reload`, and the feature ids are `permission`, `look`, `subscription`, `accounts`, `questions`, `skills`, `names`, `board`, `board-panel`, `compact`, `peers` and `remote`.

```json
{ "features": { "subscription": { "enabled": false } } }
```

To have only one piece, install its own package instead. With both installed, the first copy that loads runs the feature and the other stays off.

## The board

### What a card is

A card is something you can ask "how is it going?" about, and whose end someone else can check: a merged PR, a report, a review with a verdict, an answered question. One card per PR, with its number. Running the tests, a rebase or reading a file are steps of the work, not cards. Another agent's work is on that agent's board, never on this one.

The agent writes the board with the `board` tool. Each write is one operation (`add`, `move`, `edit`, `drop`, `decide`, or `find` to search), and the tool answers with the open board and the ids to use next. A write that breaks a rule answers with the reason instead.

| Column    | Means                                                     |
| --------- | --------------------------------------------------------- |
| `backlog` | Someday. It counts in no limit and shows only as a number |
| `todo`    | Next                                                      |
| `doing`   | Under way, with a line on what it is on now               |
| `review`  | Waiting on its reviewer, who is named                     |
| `done`    | Delivered, with its result                                |
| `dropped` | Given up, with the reason                                 |

A card in any open column can be blocked on you, on another agent by its handle, or on something outside, always with the reason. The board takes at most 3 cards in `doing` and 15 open ones, and a title says the result in 1 to 8 words. A decision is a sentence of its own, kept apart from the cards.

### Where it shows

<!-- docs:harness/board -->

<p align="center">
  <img src="https://raw.githubusercontent.com/felipeadeildo/pi-harness/main/packages/harness/assets/board.png" alt="The session's board over the whole screen, titled Board, with 4 open, 1 waiting and 1 done on the right of the top edge. Four columns side by side, each with its mark, name and count: Doing, In review, To do and Done. Every card is a box: one being done, its PR number and what it is on, chosen with an accent border; one in review with who reviews it; two to do, one in the warning color with a flag and what it waits on from you; one done with what it delivered. At the foot the backlog with its titles and the last decision. Along the bottom: move, open, close." width="860">
  <br>
  <em>Alt+T: the session's board, a column per stage and a box per card.</em>
</p>

<!-- /docs -->

`Alt+T` opens the board full screen, drawn as a board: a column each for doing, in review, to do and done, every card in its own box with its mark, what it is doing or waits on under the title, and a card that waits on you in the warning color. The backlog and the last decision sit in a strip at the foot. The arrows move between cards, `enter` opens one in full, and `Esc` closes it.

The same board reaches every reader that needs it:

- [`@adeildo/pi-look`](../look) shows the card being done on the line above the editor, with how many are blocked, to do and done.
- [`@adeildo/pi-peers`](../peers) shows each agent's cards to the others in the room, and the agent with the fewest open cards takes a request first when two fit it equally.
- [`@adeildo/pi-compact`](../compact) puts the board on top of pi's compaction summary, so the agent keeps its cards and their ids after the history is cut.
- [`@adeildo/pi-remote`](../remote) shows the board at the top of the session on the phone.

### Where it lives

Each write is a `pi-board:op` entry in the session, with the operation and its time. The board is the fold of those entries along the branch, so it follows `/tree` and forks, and nothing is merged. Other packages read the live board through the `BOARD` contract in `@adeildo/pi-kit`, and anything that reads the session file folds it with `boardOf()`.

## Settings

`Alt+S` opens the settings of every piece. They live in `~/.pi/agent/extensions/pi-harness/settings.json`, and each piece's page lists its own. A setting marked _project_ is also read from `.pi/extensions/pi-harness/settings.json` in a project Pi trusts, where the project value wins.

The whole set, with the pictures and the settings of each piece, is in the [root README](https://github.com/felipeadeildo/pi-harness).

Part of [pi-harness](https://github.com/felipeadeildo/pi-harness), which is every piece in one install.

<p align="center">
  <a href="https://adeildo.dev"><img src="https://adeildo.dev/assets/images/cat.svg" width="42" height="42" alt="adeildo.dev"></a><br>
  Brought to you by <a href="https://adeildo.dev">adeildo.dev</a>
</p>
