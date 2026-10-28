<!-- docs:banner -->

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/felipeadeildo/pi-harness/main/assets/brand/banner-dark.png">
    <img src="https://raw.githubusercontent.com/felipeadeildo/pi-harness/main/assets/brand/banner-light.png" alt="pi-harness: Pi, with you in the loop. Approve what runs, answer what the model would guess, and see what every agent is doing, on any machine of yours." width="860">
  </picture>
</p>

<!-- /docs -->

<p align="center">
  <a href="https://github.com/felipeadeildo/pi-harness/actions/workflows/ci.yml"><img src="https://github.com/felipeadeildo/pi-harness/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://www.npmjs.com/package/@adeildo/pi-harness"><img src="https://img.shields.io/npm/v/@adeildo/pi-harness" alt="npm"></a>
  <a href="https://pi.dev"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Ffelipeadeildo%2Fpi-harness%2Fmain%2Fpackage.json&query=%24.devDependencies%5B%22%40earendil-works%2Fpi-coding-agent%22%5D&label=pi%20SDK&color=6E56CF" alt="pi SDK"></a>
</p>

I write software with coding agents every day, and the agent only knows what I put in the prompt. When something is missing, it guesses. pi-harness is the set of extensions I built on top of [pi](https://pi.dev) so that stepping in costs me little: I approve or refuse a command and say why, I answer a question instead of letting the model guess, and I can see what every agent is doing, from the terminal or from my phone.

<p align="center"><code>pi install npm:@adeildo/pi-harness</code></p>

It is not a fork. Everything installs on top of pi, and `pi remove` gives you pi back the way it was. The longer story of why it exists is in [Yes, another agent harness](https://adeildo.dev/log/yes-another-agent-harness/) (in Portuguese).

<!-- docs:harness/conversation -->

<p align="center">
  <img src="https://raw.githubusercontent.com/felipeadeildo/pi-harness/main/packages/harness/assets/conversation.png" alt="A session with the look: the start card, a request, the model running the tests, committing and pushing, then the stopwatch, the card under way, the editor and the cost." width="860">
  <br>
  <em>A session: the start card, what you asked, what the model ran, and what it cost.</em>
</p>

<!-- /docs -->

## You decide what runs

Out of the box, pi runs every command the model writes. With the harness, pi asks you first. Reads run on their own, and so do the commands you marked "always yes" for the session, the project or everywhere. In `judge` mode, a small model reads each call and lets through the ones it is sure about, and each call shows who let it run and why.

When you say no, you can leave a note, such as "use pnpm instead", and the model reads it. The model can also ask you a question instead of guessing, with options and a preview of what each option leads to. Both dialogs use the same keys.

<!-- docs:harness/permission -->

<p align="center">
  <img src="https://raw.githubusercontent.com/felipeadeildo/pi-harness/main/packages/harness/assets/permission-pair.png" alt="The permission dialog for npm install, narrow: the command, the reason it asks, the three answers, the note on no, and the keys. The question dialog, narrow: two tabs, the options, and the panel with the description and the preview below them." width="860">
  <br>
  <em>Left, pi asks before it runs a command. Right, the model asks you instead of guessing.</em>
</p>

<!-- /docs -->

[Permission](packages/ask-permission) and [Questions](packages/ask-questions) have the details: the four modes, how the judge decides, and what the model reads back.

## You see what is happening

The screen is built around what you check while an agent works. The start card tells you what changed since your last session in the folder: a failed CI run, a pull request that waits on you, a branch behind its remote. Every command gets its own box with what ran, who let it run, the output and how long it took. The footer shows what the session cost and how much of your plan is left. Nothing on the screen jumps around while the agent writes.

[Look](packages/look) has the whole screen and every setting, all in `Alt+S`.

## Every session keeps a board

The agent keeps a small board of what it is doing, what waits on you and what it delivered. You open it with `Alt+T`. Other agents read the same board, so they know what yours is doing without asking it.

<!-- docs:harness/board -->

<p align="center">
  <img src="https://raw.githubusercontent.com/felipeadeildo/pi-harness/main/packages/harness/assets/board.png" alt="The session's board over the whole screen, titled Board, with 4 open, 1 waiting and 1 done on the right of the top edge. Four columns side by side, each with its mark, name and count: Doing, In review, To do and Done. Every card is a box: one being done, its PR number and what it is on, chosen with an accent border; one in review with who reviews it; two to do, one in the warning color with a flag and what it waits on from you; one done with what it delivered. At the foot the backlog with its titles and the last decision. Along the bottom: move, open, close." width="860">
  <br>
  <em>Alt+T: the session's board, a column per stage and a box per card.</em>
</p>

<!-- /docs -->

[How the board works](packages/harness/docs/board.md) explains what counts as a card and where the board shows up.

## Agents work together

Agents that you open in the same folder share a room. Each one sees the others' boards and the files they edited, and they can talk to each other. When you write to everyone, every agent hears it. When you write to anyone, the agent that fits the request best takes it. A room can also join agents from different folders, so a backend agent and a frontend agent can agree on a contract. `Alt+G` opens the rooms.

<!-- docs:peers/room -->

<p align="center">
  <img src="https://raw.githubusercontent.com/felipeadeildo/pi-harness/main/packages/peers/assets/room.png" alt="The panel over the whole screen, in a quiet frame titled Rooms, with 1 waits and 3 open on the right of the top edge. Under it a tab per room: pi-harness, open, with a flag because an agent waits on you, then backend+frontend with 1 unread. On the left the conversation, no box around any message: who joined, your request to switch the login to OAuth with the bids as bars and oauth taking it, migration's commit as a plain line, oauth asking migration about src/auth.ts and migration's answer, each a header with the time on the right, the words under it and what became of it under them, then a thin rule and the line you write in. In a column on the right the agents of the room, oauth waiting on you to push to main, migration and docs working with what each is on, and at its foot the keys that change the room." width="860">
  <br>
  <em>Alt+G: a tab per room, what was said in the open one, and who is in it on the right.</em>
</p>

<!-- /docs -->

[Peers](packages/peers) explains rooms, modes and how an agent picks up a request.

## Your sessions on your phone

When the agent needs you, you are not always at the desk. `/remote` opens every session of every machine of yours in a browser, and your phone reaches the same page over your [Tailscale](https://tailscale.com) tailnet. You can read the session as it streams, approve a command, answer a question and send the next message. Whichever screen answers first wins.

<p align="center">
  <img src="https://raw.githubusercontent.com/felipeadeildo/pi-harness/main/packages/remote/assets/phones.png" alt="Four phone screens of the remote page. The session list, with one session waiting on you to approve a bun test command. The permission ask on the phone, with yes, always yes and no. The session after the approval: the request, the board card, the test run with 3 passing tests, and the answer. A question from the model about where the change should go, with a pull request recommended." width="860">
  <br>
  <em>From the left: the session list, a command waiting for your approval, the session after you approved it, and a question from the model.</em>
</p>

[Remote](packages/remote) covers how the machines find each other, how you sign in, and what the daemon keeps.

## The rest

- **Your Claude plan.** [Providers](packages/providers) bills Anthropic requests to the Claude plan you already pay for. It keeps several accounts per provider and switches to the next one when you hit a limit, and it keeps the prompt cache warm while you are likely to come back.
- **Cheaper long sessions.** [Compact](packages/compact) hides old tool output once the context passes 150k tokens. On a week of real sessions, that cut the cost by a third.
- **Skills from anywhere.** With [Skill calls](packages/skills), you call the skills you already have from anywhere in a message, several at once.

## One piece, or all of them

`@adeildo/pi-harness` brings every piece, and `pi config` turns off the ones you do not want. Each piece is also a package of its own: `pi install npm:@adeildo/pi-look` brings the screen and nothing else.

| Package                                        | What it adds                                                           |
| ---------------------------------------------- | ---------------------------------------------------------------------- |
| [`pi-ask-permission`](packages/ask-permission) | Pi asks before it runs a command, and a small model can answer for you |
| [`pi-ask-questions`](packages/ask-questions)   | The model asks you instead of guessing                                 |
| [`pi-look`](packages/look)                     | The start card, the framed editor, a box per command, the footer       |
| [`pi-peers`](packages/peers)                   | Rooms where agents see each other's work and talk                      |
| [`pi-remote`](packages/remote)                 | Every session of every machine, in a browser and on your phone         |
| [`pi-providers`](packages/providers)           | The Claude plan, several accounts, and a warm cache                    |
| [`pi-compact`](packages/compact)               | Old tool output hidden in long sessions                                |
| [`pi-skills`](packages/skills)                 | Skills called from anywhere in a message                               |
| [`pi-kit`](packages/kit)                       | What the pieces are built with, if you want to write your own          |

## Where to read next

| You want to                    | Read                                              |
| ------------------------------ | ------------------------------------------------- |
| Use a piece                    | Its page, linked in the table above               |
| Look up a setting or a key     | The piece's `docs/reference.md`, where it has one |
| Know what is planned           | [ROADMAP.md](ROADMAP.md)                          |
| Know what changed              | [CHANGELOG.md](CHANGELOG.md)                      |
| Build a piece or send a change | [CONTRIBUTING.md](CONTRIBUTING.md)                |

## Credit

The pieces borrow ideas from other people's work, and each page says where. In short: [pi-open-tui](https://github.com/OldSuns/pi-open-tui) and [oh-my-pi](https://github.com/can1357/oh-my-pi) for the screen, [rpiv-ask-user-question](https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-ask-user-question) for the questions, [pi-claude-max](https://github.com/bradennss/pi-claude-max) for the Claude plan, and [pi-multiprovider](https://github.com/monotykamary/pi-multiprovider) for several accounts of one provider.

<!-- docs:footer -->

<p align="center">
  <a href="https://adeildo.dev"><img src="https://adeildo.dev/assets/images/cat.svg" width="42" height="42" alt="adeildo.dev"></a><br>
  <a href="https://github.com/felipeadeildo/pi-harness">pi-harness</a> is made by <a href="https://adeildo.dev">adeildo.dev</a>
</p>

<!-- /docs -->
