<h1 align="center">@adeildo/pi-board</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/@adeildo/pi-board"><img src="https://img.shields.io/npm/v/@adeildo/pi-board" alt="npm"></a>
  <a href="https://pi.dev"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Ffelipeadeildo%2Fpi-harness%2Fmain%2Fpackage.json&query=%24.devDependencies%5B%22%40earendil-works%2Fpi-coding-agent%22%5D&label=pi%20SDK&color=6E56CF" alt="pi SDK"></a>
</p>

<p align="center">
  <strong>What the session is doing, what waits on you, and what it delivered.</strong><br>
  The agent keeps it with a tool, and you open it with Alt+T.
</p>

<p align="center"><code>pi install npm:@adeildo/pi-board</code></p>

## What a card is

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

## Where it shows

<!-- docs:board/panel -->

<p align="center">
  <img src="https://raw.githubusercontent.com/felipeadeildo/pi-harness/main/packages/board/assets/panel.png" alt="The session's board over the chat: a line saying three cards are open, one is in the backlog and one is done, then one card per line with its column first: one being done with what it is on now, one in review with its reviewer, and one to do that waits on you, with the reason." width="860">
  <br>
  <em>Alt+T: the session's board, and what waits on you.</em>
</p>

<!-- /docs -->

`Alt+T` opens the board over the chat: how many cards are open, in the backlog and done, then one line per open card with its column first, so a card that moves changes only its own line. It updates while open, and `Esc` closes it.

The same board reaches every reader that needs it:

- [`@adeildo/pi-look`](../look) shows the card being done on the line above the editor, with how many are blocked, to do and done.
- [`@adeildo/pi-peers`](../peers) shows each agent's cards to the others in the room, and the agent with the fewest open cards takes a request first when two fit it equally.
- [`@adeildo/pi-compact`](../compact) puts the board on top of pi's compaction summary, so the agent keeps its cards and their ids after the history is cut.
- [`@adeildo/pi-remote`](../remote) shows the board at the top of the session on the phone.

## Where it lives

Each write is a `pi-board:op` entry in the session, with the operation and its time. The board is the fold of those entries along the branch, so it follows `/tree` and forks, and nothing is merged. Other packages read the live board through the `BOARD` contract in `@adeildo/pi-kit`, and anything that reads the session file folds it with `boardOf()`.

Part of [pi-harness](https://github.com/felipeadeildo/pi-harness), which brings every piece in one install.

<p align="center">
  <a href="https://adeildo.dev"><img src="https://adeildo.dev/assets/images/cat.svg" width="42" height="42" alt="adeildo.dev"></a><br>
  Brought to you by <a href="https://adeildo.dev">adeildo.dev</a>
</p>
