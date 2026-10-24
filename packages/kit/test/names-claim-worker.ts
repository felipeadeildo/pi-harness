// One process of the reclaim race: it waits for the shared start and then tries to take every word.
import { claimWord } from "../src/names/claim.ts";

const [dir, session, count, startAt] = process.argv.slice(2);
if (dir === undefined || session === undefined || count === undefined || startAt === undefined)
	throw new Error("usage: names-claim-worker.ts <dir> <session> <count> <startAt>");
while (Date.now() < Number(startAt)) {
	// Spin, so every worker enters the draw at the same millisecond.
}
const got: string[] = [];
for (let index = 0; index < Number(count); index++) {
	const word = `w${index}`;
	if (claimWord({ dir, lives: (held) => held.startsWith("p") }, word, session, "m")) got.push(word);
}
console.log(JSON.stringify(got));
