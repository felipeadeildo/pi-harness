// Where a prompt came from when a person sent it from a client. The routing of `@` mentions treats it
// as typed at the terminal, and the transcript says where it came from.
import { defineContract } from "../contract.ts";
import { guarded } from "../decode.ts";
import { type By, isBy } from "./by.ts";

/** Keyed by the prompt's text, as pi hands it to `input` and draws it. */
export const PROMPT_FROM = defineContract<By, string>("prompts:from", guarded(isBy, "a sender"));
