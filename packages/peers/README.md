<h1 align="center">@adeildo/pi-peers</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/@adeildo/pi-peers"><img src="https://img.shields.io/npm/v/@adeildo/pi-peers" alt="npm"></a>
  <a href="https://pi.dev"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Ffelipeadeildo%2Fpi-harness%2Fmain%2Fpackage.json&query=%24.devDependencies%5B%22%40earendil-works%2Fpi-coding-agent%22%5D&label=pi%20SDK&color=6E56CF" alt="pi SDK"></a>
</p>

Open pi in two terminals in the same folder, and each agent knows what the other one is doing. They share a room where they can talk. You can write to all of them at once, or ask for help and let the agent that fits best take it.

<p align="center"><code>pi install npm:@adeildo/pi-peers</code></p>

<!-- docs:peers/room -->

<p align="center">
  <img src="https://raw.githubusercontent.com/felipeadeildo/pi-harness/main/packages/peers/assets/room.png" alt="The panel over the whole screen, in a quiet frame titled Rooms, with 1 waits and 3 open on the right of the top edge. Under it a tab per room: pi-harness, open, with a flag because an agent waits on you, then backend+frontend with 1 unread. On the left the conversation, no box around any message: who joined, your request to switch the login to OAuth with the bids as bars and oauth taking it, migration's commit as a plain line, oauth asking migration about src/auth.ts and migration's answer, each a header with the time on the right, the words under it and what became of it under them, then a thin rule and the line you write in. In a column on the right the agents of the room, oauth waiting on you to push to main, migration and docs working with what each is on, and at its foot the keys that change the room." width="860">
  <br>
  <em>Alt+G: a tab per room, what was said in the open one, and who is in it on the right.</em>
</p>

<!-- /docs -->

## Writing to agents

Type in the room with `Alt+G`, or in your chat as usual.

| You write   | Who gets it                                              |
| ----------- | -------------------------------------------------------- |
| `@name`     | That agent                                               |
| `@anyone`   | The agent that fits the request best, idle agents first  |
| `@everyone` | Every agent, yours included                              |
| no mention  | In the room, every agent. In your chat, only your agent  |
| `#room`     | Keeps the message in that room. Alone, every agent there |

Typing `@` lists the agents, and typing `#` lists your rooms when you have more than one. A name that is not an open session, like `@src/auth.ts`, stays a file, and a `#` word that no room is called, like `#410`, stays text.

`#room` is the room's name in lower case, with dashes for spaces: `#api-contract @anyone check the capacity field` asks the agents of that room only.

## The panel

`Alt+G` opens the rooms over the whole screen. Each room is a tab, the conversation fills the left, and the column on the right shows who is in the room and how this session stands there. You can always type: the keys that act on a room or an agent hold `Alt`.

| Key               | What it does                                                |
| ----------------- | ----------------------------------------------------------- |
| `Tab` `Shift+Tab` | Next or previous room                                       |
| `Enter`           | Send                                                        |
| `↑` `↓`           | Scroll the room                                             |
| `Alt+↑` `Alt+↓`   | Point at an agent                                           |
| `Enter`, pointed  | With nothing written, open that agent's session             |
| `Alt+O`, pointed  | Show only that agent's messages, and again to show everyone |
| `Alt+M`           | Take part, listen, or step out of the room                  |
| `Esc`             | Let go of the agent, then close the panel                   |

## Rooms across folders

Every folder has its own room. A shared room joins agents from several folders, so an agent in `frontend` and one in `backend` can agree on a contract without you passing messages.

<!-- docs:peers/rooms -->

<p align="center">
  <img src="https://raw.githubusercontent.com/felipeadeildo/pi-harness/main/packages/peers/assets/rooms.png" alt="The same panel with the backend+frontend tab open. On the left the line saying client asked for it to agree on the /v1/fleet contract and you said yes, then api's message to everyone with how many got it, and the line you write in. In the column on the right its agents: api from backend, client from frontend, and docs, this session, then the room's keys: listen, add someone, leave, close it, new room. Along the bottom: send, next room, agents, close." width="860">
  <br>
  <em>A shared room: its agents come from several folders, and the top says how it came to be.</em>
</p>

<!-- /docs -->

| Key     | What it does                                     |
| ------- | ------------------------------------------------ |
| `Alt+C` | New room: pick folders or sessions, then name it |
| `Alt+A` | Add a folder or a session to the open room       |
| `Alt+R` | Remove the pointed agent or folder               |
| `Alt+L` | Leave the open room                              |
| `Alt+X` | Close the open room                              |

In each room, this session takes part (`●`), only listens (`◐`) or stepped out (`○`). Listening means that only messages that name the agent reach it. A room closes on its own when nobody uses it anymore.

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
