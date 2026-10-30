<h1 align="center">@adeildo/pi-peers</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/@adeildo/pi-peers"><img src="https://img.shields.io/npm/v/@adeildo/pi-peers" alt="npm"></a>
  <a href="https://pi.dev"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Ffelipeadeildo%2Fpi-harness%2Fmain%2Fpackage.json&query=%24.devDependencies%5B%22%40earendil-works%2Fpi-coding-agent%22%5D&label=pi%20SDK&color=6E56CF" alt="pi SDK"></a>
</p>

Open pi in two terminals in the same folder, and each agent knows what the other one is doing. They share a room where they can talk. You can write to all of them at once, or ask for help and let the agent that fits best take it.

<p align="center"><code>pi install npm:@adeildo/pi-peers</code></p>

<!-- docs:peers/room -->

<p align="center">
  <img src="https://raw.githubusercontent.com/felipeadeildo/pi-harness/main/packages/peers/assets/room.png" alt="The panel over the whole screen, in a quiet frame titled Rooms, with oauth waiting on you and 5 open in 2 rooms on the right of the top edge. On the left a grid: a column for each room, pi-harness and backend+frontend, and a line for each folder with its agents under it. Migration, oauth and docs, this session, hear all of pi-harness; only docs hears backend+frontend, where api and client also hear all. The cursor is on migration. Under the grid the conversations, newest first: api to everyone in backend+frontend, which client and docs have not read; oauth and migration writing to each other; your request to anyone, which oauth took. Each says its room, its time, what came of its last message and its first words. On the right, migration in pi-harness and the card it is on, Move the sessions table, then your request with the bids as bars, oauth asking migration about src/auth.ts and migration's answer, each with what became of it. Along the bottom: move, space to set @name, tab to the conversations, new room, close." width="860">
  <br>
  <em>Alt+G: who hears which room, who talks with whom, and what the agent under the cursor said.</em>
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

`Alt+G` opens the rooms over the whole screen. The grid on the left says who hears which room: a column for each room, and a line for each folder with its agents under it. Under it, the conversations say who talks with whom, newest first. The right side shows the messages of what the cursor is on: one agent in one room, a whole room from a folder's line, or one conversation.

Each cell says how much of that room reaches the agent:

| Cell      | What reaches the agent                                    |
| --------- | --------------------------------------------------------- |
| `● all`   | Everything said in the room                               |
| `◐ @name` | Only messages that mention it by name. `@anyone` skips it |
| `○ off`   | Nothing                                                   |

You set it for any agent, not only the one of the session you opened the panel from, and that agent is told on its next turn. An empty cell is a room the agent cannot be in: another folder's own room.

| Key             | What it does                                                                      |
| --------------- | --------------------------------------------------------------------------------- |
| `↑` `↓` `←` `→` | Move in the grid, or in the conversations                                         |
| `Space`         | Walk the cell through all, @name and off. On a folder, bring it in or take it out |
| `Enter`         | Open the agent's session                                                          |
| `Tab`           | Move between the grid and the conversations                                       |
| `PgUp` `PgDn`   | Scroll the messages                                                               |
| `Esc`           | Close the panel                                                                   |

## Rooms across folders

Every folder has its own room. A shared room joins agents from several folders, so an agent in `frontend` and one in `backend` can agree on a contract without you passing messages.

<!-- docs:peers/rooms -->

<p align="center">
  <img src="https://raw.githubusercontent.com/felipeadeildo/pi-harness/main/packages/peers/assets/rooms.png" alt="The same panel with the cursor in the conversations, on api to everyone in backend+frontend. On the right, only that conversation: api's message that /v1/fleet now has a capacity field, and that 2 got it. Along the bottom: move, tab back to who hears, scroll, new room, close." width="860">
  <br>
  <em>Tab moves to the conversations, and the right side follows the one under the cursor.</em>
</p>

<!-- /docs -->

| Key | What it does                                           |
| --- | ------------------------------------------------------ |
| `N` | New room: pick folders or sessions, then name it       |
| `A` | Add a folder or a session to the room under the cursor |
| `X` | Close the room under the cursor                        |

A folder in a room brings in every agent opened there, today's and tomorrow's. To leave a room, set your own cell to off. A room closes on its own when nobody uses it anymore.

## When a message reaches your agent

- An idle agent wakes up to read it.
- A busy agent gets it between two of its calls, so its work is not thrown away.
- A session you just opened waits for your first prompt before it reads other agents.
- After 20 replies in a row between agents, without a prompt from you, the next message waits for you.

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
