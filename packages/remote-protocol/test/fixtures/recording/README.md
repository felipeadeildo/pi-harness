# A recorded session

Written by `bun scripts/record-session.ts`. A scripted model ran three
turns: the first with thinking and a tool call, the other two plain. The tasks feature kept the list
after each one. Between the second and the third, the tree moved back to the first entry, so the
third turn hangs from an older entry than the one before it. `session.jsonl` is pi's file and
`harness.jsonl` is the harness's log. The reducers in `test/transcript.test.ts` rebuild both.

An aborted turn and a compaction are not here: the scripted model cannot be stopped mid answer,
and pi refuses to compact a session this short. `test/edges.test.ts` covers them with lines
captured from a real run.
