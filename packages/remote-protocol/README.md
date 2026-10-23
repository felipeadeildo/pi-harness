# @adeildo/pi-remote-protocol

The shapes that cross a process in pi-remote, and the reducers that rebuild a session from them.

The package holds the envelope, the facts the harness writes to its log, and the transcript of a
branch. It imports nothing: no pi, no kit, no `node:`. The Expo app and the daemon both use it, and
the daemon bundles it.

The kit's types are copied here instead of imported, because the kit is published and cannot depend
on a private package. `test/conformance.test.ts` imports the kit's types and checks that they are
assignable to the copies, so the two cannot drift.

```ts
import { isEnvelope, reduceFacts, transcriptOf } from "@adeildo/pi-remote-protocol";

const transcript = transcriptOf(entries, leaf);
const facts = reduceFacts(logged);
```
