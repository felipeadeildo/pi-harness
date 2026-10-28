# How compact works

The [README](../README.md) covers what compact does. This page explains the choices behind it.

## The prune

When a run ends with more than 150k tokens of context, each tool output older than the last 10 turns becomes one line that names its call:

```text
Output hidden to save context, about 4.2k tokens. It came from: read src/view.ts. Run it again if you need it.
```

Long arguments are removed whole, like a script sent to bash or a file sent to write, and a note on the call says which ones went. Cutting a value short would teach the model to cut its own values: in a live session, after a prune that cut values that way, the agent wrote new calls that were cut the same way, and they ran. So a call that copies the note, or a value cut the old way, does not run.

Your messages, the agent's own words, errors and the last 10 turns stay whole. After a prune, the agent gets the session's [board](../../harness#the-board) at the end of its context, so it keeps track of its work.

The prune runs when a run ends, so the cache rewrite that it costs falls on your next message. If you were away for longer than the cache lives, that message writes the whole prompt anyway. In the middle of a run, a turn prunes only when the context passes 80% of the model's window, before pi's own compaction.

Each prune leaves a line in the chat, with what rewriting the prompt cache costs and when that pays back. `Ctrl+O` lists the calls that it hid.

## Clearing on Anthropic's side

Anthropic can clear old output on its own side instead, with [`clear_tool_uses`](https://platform.claude.com/docs/en/build-with-claude/context-editing). This is off by default. It keeps the agent's thinking, which a local edit drops for every later turn, because Anthropic signs each thinking block together with the conversation before it. But in a session of 744 requests on Opus 5.5, each of its 15 clears made the next request write the whole prompt again, 450k to 600k tokens, to free only 5% to 30% of it, since the thinking stays. Each clear cost about $2 and saved a few cents per request.

## When pi compacts anyway

When pi compacts, pi's own prompt writes the summary on a small model, and the session's board and your last words go on top unchanged, so no model rewords a decision. When the board is empty, pi writes the summary on the session's model.

To check that a small model is enough, an agent that only had the summary answered 48 questions about what was dropped from six recorded sessions, and a judge graded the answers against the truth. pi's summary written on Haiku scored as well as on Opus, within the judge's noise, for 1/40 of the price. A first version that wrote its own short summary scored 2.6 out of 5, against 3.9 for pi's, and was dropped. The method is [Factory's probes](https://factory.ai/news/evaluating-compression), and `bun packages/compact/eval/summary.ts` runs it.

## Why it works this way

- Hiding old tool output works as well as summarizing it and costs less. With summaries, agents ran 13 to 15% longer ([JetBrains, NeurIPS 2025](https://arxiv.org/abs/2508.21433)).
- Letting a model pick what to keep cost 94% more with no gain in quality ([OpenHands, 2026](https://arxiv.org/abs/2605.18854)). The rules here are plain code.
- After a prune, the next request writes the whole conversation to the prompt cache again. Anthropic reuses the cache only from the point an earlier request wrote it ([Anthropic](https://platform.claude.com/docs/en/build-with-claude/context-editing)), and the old cache entries near old outputs have expired. So a prune waits until it can free at least two fifths of the context at once. Pruning a little every turn would cost 3.4 times as much.
- Errors stay, and every placeholder keeps its call, as [Manus](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus) recommends.

Replaying a week of real sessions, mostly Opus with a 1M context, costs 32% less with the prune. The replay makes the request after each prune write the whole context again, so the real saving is at least that. `bun packages/compact/eval/replay.ts [--server 10]` replays your own sessions.

## With pi's compaction

This package turns off nothing in pi. A turn past 80% of the window prunes right before pi checks its own threshold, so pi rarely needs to compact. `/compact` and automatic compaction still work, and this package only writes their summary. The prune is a `context_edit`, so the session file keeps every output, and going back with `/tree` shows them again. Anthropic's clearing changes nothing in the session file.

<!-- docs:footer -->

<p align="center">
  <a href="https://adeildo.dev"><img src="https://adeildo.dev/assets/images/cat.svg" width="42" height="42" alt="adeildo.dev"></a><br>
  <a href="https://github.com/felipeadeildo/pi-harness">pi-harness</a> is made by <a href="https://adeildo.dev">adeildo.dev</a>
</p>

<!-- /docs -->
