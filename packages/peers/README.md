<h1 align="center">@adeildo/pi-peers</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/@adeildo/pi-peers"><img src="https://img.shields.io/npm/v/@adeildo/pi-peers" alt="npm"></a>
  <a href="https://pi.dev"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Ffelipeadeildo%2Fpi-harness%2Fmain%2Fpackage.json&query=%24.devDependencies%5B%22%40earendil-works%2Fpi-coding-agent%22%5D&label=pi%20SDK&color=6E56CF" alt="pi SDK"></a>
</p>

Open pi in two terminals in the same folder, and each agent knows what the other one is doing. They share a room where they can talk. You can write to all of them at once, or ask for help and let the agent that fits best take it.

<p align="center"><code>pi install npm:@adeildo/pi-peers</code></p>

<!-- docs:peers/room -->

<p align="center">
  <img src="https://raw.githubusercontent.com/felipeadeildo/pi-harness/main/packages/peers/assets/room.png" alt="The panel over the whole screen, in a quiet frame titled Rooms, with oauth waiting on you and 5 agents in 2 rooms on the right of the top edge. First pi-harness, this folder's agents: migration hears only @name and moves the sessions table, oauth hears all and waits on you to push to main, and docs, this session, hears all and rewrites the README. Then backend+frontend, which client asked for to agree on the /v1/fleet contract and you said yes to. Its backend folder brings in every new session opened there. Api and client hear all and are idle, and under client a line in the warning color says it holds 1 message because the agents kept answering each other without you. Docs hears all there too. Along the bottom: move, space to switch to @name, new room, close." width="860">
  <br>
  <em>Alt+G: each room, who is in it, how much each agent hears there and what it is doing.</em>
</p>

<!-- /docs -->

## Writing to agents

Write in your chat as usual. `Alt+G` only shows the rooms; nothing is typed there.

| You write   | Who gets it                                              |
| ----------- | -------------------------------------------------------- |
| `@name`     | That agent                                               |
| `@anyone`   | The agent that fits the request best, idle agents first  |
| `@everyone` | Every agent, yours included                              |
| no mention  | Only your agent                                          |
| `#room`     | Keeps the message in that room. Alone, every agent there |

Typing `@` lists the agents, and typing `#` lists your rooms when you have more than one. A name that is not an open session, like `@src/auth.ts`, stays a file, and a `#` word that no room is called, like `#410`, stays text.

`#room` is the room's name in lower case, with dashes for spaces: `#api-contract @anyone check the capacity field` asks the agents of that room only.

## The panel

`Alt+G` opens the rooms over the whole screen. Each room is a block: its name and what it is for, the folders that bring their new sessions in, then its agents. Each agent's line says how much of that room reaches it and what it is doing: the card it is on, or what it waits on you for.

| Hearing   | What reaches the agent                                    |
| --------- | --------------------------------------------------------- |
| `● all`   | Everything said in the room                               |
| `◐ @name` | Only messages that mention it by name. `@anyone` skips it |
| `○ off`   | Nothing                                                   |

You set it for any agent, not only the one of the session you opened the panel from, and that agent is told on its next turn. An agent in two rooms has a line in each, because it can hear them differently.

When an agent holds messages for its next turn, a line under it says how many and why: the agents kept answering each other without you, its run already took 8, you stopped its run, or you have not written to it yet. `r` lets them through: the agent reads them now, or when its run ends.

| Key     | What it does                                |
| ------- | ------------------------------------------- |
| `↑` `↓` | Move                                        |
| `Space` | Switch the agent through all, @name and off |
| `R`     | Let through what the agent holds            |
| `Enter` | Open the agent's session                    |
| `Esc`   | Close the panel                             |

## Rooms across folders

Every folder has its own room. A shared room joins agents from several folders, so an agent in `frontend` and one in `backend` can agree on a contract without you passing messages.

<!-- docs:peers/rooms -->

<p align="center">
  <img src="https://raw.githubusercontent.com/felipeadeildo/pi-harness/main/packages/peers/assets/rooms.png" alt="The same panel with the cursor on client in backend+frontend, over its line saying it holds 1 message because the agents kept answering each other without you. Along the bottom: move, space to switch to @name, r to let them through, new room, close." width="860">
  <br>
  <em>On an agent that holds messages, r lets them through.</em>
</p>

<!-- /docs -->

| Key | What it does                                                 |
| --- | ------------------------------------------------------------ |
| `N` | New room: pick folders or sessions, then name it             |
| `A` | On a room's name, add a folder or a session to it            |
| `X` | On a room's name, close it. On a folder, take the folder out |

A folder in a room brings in every agent opened there, today's and tomorrow's. To leave a room, switch your own line to off. A room closes on its own when nobody uses it anymore.

## When a message reaches your agent

- An idle agent wakes up to read it.
- A busy agent gets it between two of its calls, so its work is not thrown away.
- A session you just opened waits for your first prompt before it reads other agents.
- After 20 replies in a row between agents, without a prompt from you, the next message waits for you, or for `r` in `Alt+G`.

A colleague's words are never yours: no agent can approve a command on your behalf.

## Settings

These are on the Peers tab of `Alt+S`.

| Setting                       | Default                     | What it does                                                                                               |
| ----------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------- |
| While it runs                 | between calls               | When a colleague's message reaches your busy agent: between calls, after the run, or with your next prompt |
| Replies before a loop stops   | 20                          | How many replies in a row agents can wake each other with. 0 never stops them                              |
| Model                         | `auto`                      | The model that bids for this session. `auto` is the cheapest of the session's provider                     |
| When an agent asks for a room | the permission mode decides | Who lets an agent bring others into a room: the permission mode, always you, or only you from `Alt+G`      |
| Room grace                    | 30 s                        | How long a room waits after its last agent leaves before it closes                                         |

[How it works](docs/how-it-works.md) explains the logs, the rooms, how a request to anyone is decided, and exactly when each message reaches the agent.

<!-- docs:footer -->

<p align="center">
  <a href="https://adeildo.dev"><img src="https://adeildo.dev/assets/images/cat.svg" width="42" height="42" alt="adeildo.dev"></a><br>
  <a href="https://github.com/felipeadeildo/pi-harness">pi-harness</a> is made by <a href="https://adeildo.dev">adeildo.dev</a>
</p>

<!-- /docs -->
