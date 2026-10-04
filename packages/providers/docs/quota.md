# Plan quota

What a plan has left, where that number comes from, and how a provider joins. The readers live in `src/usage/`; the editor frame, the account picker and the limit messages read the same result.

## Three sources, in order

| Source                                  | Gives                                     | Costs                                      | When                      |
| --------------------------------------- | ----------------------------------------- | ------------------------------------------ | ------------------------- |
| The headers on every inference response | Percent used and the reset of each window | Nothing beyond the call already being made | Always, passively         |
| The provider's usage endpoint           | The same windows, plus what only it knows | One request from a small per-token bucket  | When there is no reading  |
| A one-token call                        | The same headers as the first source      | One minimal request                        | When the endpoint refuses |

The endpoint is asked once per account per process. The one-token call is the fallback, not a poll: a rejection carries the windows as well.

## The reader contract

`QuotaReader` (`src/usage/types.ts`) is what a provider implements:

| Field     | Is                                                                      |
| --------- | ----------------------------------------------------------------------- |
| `read`    | The source that reports the windows                                     |
| `probe`   | What to try when `read` refuses                                         |
| `headers` | The windows a normal response carries, when the provider publishes them |

`Quota` (`src/usage/quota.ts`) keys readings by provider and account, keeps one request in flight per key, remembers a failure for 15 minutes, and reads again once a window has rolled over. It never throws and never polls on a timer.

## Adding a provider

1. A module under `src/usage/` that builds a `QuotaReader` and parses its own answer and headers.
2. One entry in the record the feature builds, as `new Quota({ anthropic: anthropicQuota(version) })`.
3. Nothing else. The frame, the picker and the limit messages read the shared shape.

A provider that bills per token instead of by window (DeepSeek and friends) needs a spend meter (`used` of `limit`) in `AccountUsage`, not a percent window. Not built yet.

## Anthropic

| What               | Where                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------ |
| The windows        | `anthropic-ratelimit-unified-5h-*` and `-7d-*` on every response; `five_hour` and `seven_day` in the endpoint body |
| The endpoint       | `GET https://api.anthropic.com/api/oauth/usage`, with `anthropic-beta: oauth-2025-04-20`                           |
| The one-token call | `POST /v1/messages`, `max_tokens: 1`, `claude-haiku-4-5`, with the Claude Code identity                            |

Traps that were already paid for:

- The header utilization is a fraction (`0.23`), the endpoint's is a percent (`23.0`).
- The endpoint is rate limited per access token, around five requests, and the 429 persists with `retry-after: 0`. It picks its bucket by `User-Agent`, so the call wears the Claude Code identity.
- A rejection carries the windows too, which is what makes the one-token call work while an account is at 100%.
- A window whose reset already passed counts as empty, so a stale reading never shows a spent account as full.

## Sources

[pi-usage](https://github.com/mtrojnar/pi-usage) is the closest prior art in the pi ecosystem, and the three-source ladder comes from it. The header names and the penalty for a bare `User-Agent` are documented in [ccmeter](https://github.com/iteebz/ccmeter) and the two rate-limit bugs, [anthropics/claude-code#30930](https://github.com/anthropics/claude-code/issues/30930) and [#31637](https://github.com/anthropics/claude-code/issues/31637).
