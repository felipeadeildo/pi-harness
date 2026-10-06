<h1 align="center">@adeildo/pi-goal</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/@adeildo/pi-goal"><img src="https://img.shields.io/npm/v/@adeildo/pi-goal" alt="npm"></a>
  <a href="https://pi.dev"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Ffelipeadeildo%2Fpi-harness%2Fmain%2Fpackage.json&query=%24.devDependencies%5B%22%40earendil-works%2Fpi-coding-agent%22%5D&label=pi%20SDK&color=6E56CF" alt="pi SDK"></a>
</p>

<p align="center">
  <strong>What the session is after, kept up to date while you work.</strong><br>
  The goal, the step under way, what was done and what was left for later.
</p>

<p align="center"><code>pi install npm:@adeildo/pi-goal</code></p>

## What it keeps

A timeline of the session, in three parts. Each part is kept for whoever reads it:

```text
Goal: turn the goal into the session's timeline
Now:  [g3] Wire the timeline into the look
Later:
- [g2] Frame the user's message (another commit)
Done:
- [g1] Add the contract to the kit (docs not written yet)
```

- **Now** is what the session is on. The permission judge reads it as your intent. Another agent, later, reads it to know what this session is doing without asking it.
- **Done** keeps a finished step from being done again. Its note says what the step left out, like `docs not written yet`, which a later step has to close.
- **Later** is what was put off, with why it waits. It keeps those items in view after the conversation moves on.

Work that stops halfway goes back to later with what is missing, not to done.

## How it stays current

Nobody has to write it. Each item is written for someone who reads the session later without the code: what changed for you or the project, not which file changed.

A model reads the timeline and only what changed since the last update. It answers with operations, like starting a step, pausing it, finishing it with what it left out, or putting something off. It never sends a whole new list, so it cannot rewrite what was done.

- Your message updates it at once, so the judge has your intent before the agent's first call.
- During a long turn, it updates once a minute at most, and only when the agent made new calls. Most of those updates change nothing, and then nothing is written. Your last message goes with the work, so the model can tell whether the work answered it.
- When the agent stops, it reads what is left.
- While the agent works, the strip shows the current step in its running form, like `Showing the goal on the top strip`.
- After each run, one tidy pass looks at the whole timeline: it merges items that say the same work, finishes the ones the work completed, and drops questions listed as if they were work.

The model writes every item in the language of your messages, and the timeline records which language that is.

To correct it, say what you want. "Leave the frame for later" moves the frame to later. `Alt+S` shows the timeline on the Goal tab, where you can edit the goal, the current step and the later list by hand.

## Where it shows

Pi's footer shows the step under way. With [`@adeildo/pi-look`](../look), it sits on the right of the line above the editor, with how many items are done and how many wait. When the line has no room for it, it gets a line of its own.

## Who reads it

- The permission judge of [`@adeildo/pi-ask-permission`](../ask-permission) reads the goal and the current step as your intent, beside your last message.
- Other packages read it through `currentGoal()` in `@adeildo/pi-kit`, and anything that reads the session file reads it with `goalFromEntries()`.

Each change is a `pi-goal:update` entry in the session. It records the operations, what set them off, the entries the model read (`covers`), the model, the cost and the resulting timeline. Each item records the entry where it started and the one where it finished, so a reader can open that part of the conversation. The current timeline is the last update on the branch, so it follows `/tree` and forks.

## Only your words become the intent

The goal and a step count as your intent only when they came from your messages or from `Alt+S`. The agent's work can finish a step or add one. It can also fill in a missing goal, which shows on screen but never reaches the judge, and it cannot replace a goal you set. The updater never sees what a tool returned, so instructions inside a file or a page cannot become the intent the judge reads.

## Settings

On the Goal tab of `Alt+S`, stored under `goal` in `~/.pi/agent/extensions/pi-harness/settings.json`:

| Setting               | Default | Does                                                                                                                                            |
| --------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Model                 | `auto`  | `auto` is the cheapest model of the session's provider, `session` the one you talk to, or any model. When it fails, the session's model answers |
| While the agent works | `60`    | Seconds between updates during a long turn. `0` updates only on your messages and when the agent stops                                          |

Each call is one short request. With Claude Haiku it takes about 3 seconds and costs about $0.002, so a ten-minute turn costs about $0.03 at the defaults. Every call records what it cost, even one that changed nothing (`pi-goal:usage`). The Goal tab shows the total, and the look adds it to the session's cost. Updates run only when pi has a UI, so print runs and subagents make no extra calls.

## License

MIT
