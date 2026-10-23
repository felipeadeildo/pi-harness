# A recorded session

Written by `bun scripts/record-session.ts` against pi 1.4.0. A scripted model ran two
turns: the first with thinking and a tool call, the second plain. The tasks feature kept the list
after each one, and the tree moved back to the first entry at the end. `session.jsonl` is pi's
file, `harness.jsonl` is the harness's log, and both are rebuilt by the reducers in
`test/transcript.test.ts`.
