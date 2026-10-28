# How the board works

The [README](../README.md#the-board) says what the board is for. This page covers the rules.

## What a card is

A card is a piece of work that someone can ask "how is it going?" about, and that someone else can check when it ends: a merged pull request, a report, a review with a verdict, an answered question. A pull request gets one card, with its number. Running the tests or reading a file are steps of the work, not cards. Work that another agent does goes on that agent's board.

The agent writes its board with the `board` tool, one operation per call: `add`, `move`, `edit`, `drop`, `decide`, or `find` to search. The tool answers with the open board and the ids to use next. When a call breaks a rule, the tool answers with the reason instead.

| Column    | What it means                                                 |
| --------- | ------------------------------------------------------------- |
| `backlog` | Someday. It counts toward no limit and shows only as a number |
| `todo`    | Next                                                          |
| `doing`   | Under way, with a line on where it stands                     |
| `review`  | Waiting on a reviewer, who is named                           |
| `done`    | Delivered, with the result                                    |
| `dropped` | Given up, with the reason                                     |

An open card can wait on you, on another agent, or on something outside, and the card always says why. When the answer arrives, the agent clears the wait with `unblock`. A card that moves to done or is dropped stops waiting on its own. The board holds at most 3 cards in `doing` and 15 open cards, and a title is the result in 1 to 8 words. A decision is a sentence of its own, kept apart from the cards.

## Where you see it

`Alt+T` opens the board over the whole screen, with a column for each stage. Each card is a box with its mark, its title, and under it what the agent is doing, who reviews it, what it waits on or what it delivered. A card that waits on you is drawn in the warning color. The backlog and the last decision sit at the bottom. The arrow keys move between cards, `Enter` opens one with every field, and `Esc` closes the board.

The same board shows up in other places:

- [`@adeildo/pi-look`](../../look) shows the card under way above the editor, with how many cards are blocked, to do and done.
- [`@adeildo/pi-peers`](../../peers) shows each agent's cards to the others in its rooms. When two agents fit a request equally well, the one with fewer open cards takes it.
- [`@adeildo/pi-compact`](../../compact) puts the board on top of pi's compaction summary, so the agent keeps its cards and their ids after the history is cut.
- [`@adeildo/pi-remote`](../../remote) shows the board at the top of the session on your phone.

## Where it is stored

Each write is a `pi-board:op` entry in the session file, with the operation and its time. The board is what you get when you apply those entries in order along the branch, so it follows `/tree` and forks, and nothing needs merging. Other packages read the live board through the `BOARD` contract in `@adeildo/pi-kit`, and code that reads a session file can rebuild the board with `boardOf()`.

<!-- docs:footer -->

<p align="center">
  <a href="https://adeildo.dev"><img src="https://adeildo.dev/assets/images/cat.svg" width="42" height="42" alt="adeildo.dev"></a><br>
  <a href="https://github.com/felipeadeildo/pi-harness">pi-harness</a> is made by <a href="https://adeildo.dev">adeildo.dev</a>
</p>

<!-- /docs -->
