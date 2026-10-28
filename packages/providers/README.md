<h1 align="center">@adeildo/pi-providers</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/@adeildo/pi-providers"><img src="https://img.shields.io/npm/v/@adeildo/pi-providers" alt="npm"></a>
  <a href="https://pi.dev"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Ffelipeadeildo%2Fpi-harness%2Fmain%2Fpackage.json&query=%24.devDependencies%5B%22%40earendil-works%2Fpi-coding-agent%22%5D&label=pi%20SDK&color=6E56CF" alt="pi SDK"></a>
</p>

Get more out of the plans and accounts you already have: bill pi to your Claude plan, keep several accounts per provider, keep the prompt cache warm while you are away, and add any OpenAI-compatible endpoint.

<p align="center"><code>pi install npm:@adeildo/pi-providers</code></p>

## Your Claude plan

With a Claude Pro or Max plan connected through `/login anthropic`, pi's requests count as extra usage, billed by the token. With this package, they come out of the plan instead, the way Claude Code's requests do.

> [!WARNING]
> This works by presenting pi to Anthropic as Claude Code, and using a subscription outside Claude Code may break Anthropic's terms. It is on as soon as you install the package. To turn it off, switch the `subscription` feature off in `pi config`. Requests that use an API key go out unchanged.

Once the plan pays, pi's warning about extra usage is wrong. Turn it off in `~/.pi/agent/settings.json`:

```json
{ "warnings": { "anthropicExtraUsage": false } }
```

## Several accounts

Keep more than one account per provider, such as a work one and a personal one.

| Where         | What you do                                                             |
| ------------- | ----------------------------------------------------------------------- |
| `/accounts`   | List the accounts of the current provider, with what each plan has left |
| `Enter`       | Use the account under the cursor                                        |
| `a`, `r`, `d` | Add, rename or remove an account                                        |
| `Alt+A`       | Switch the account of this session                                      |

When an account hits its limit, pi can ask you, switch to the next account on its own, or stop. `accounts.onLimit` decides, and it asks by default. A switch only happens before anything was shown, so you never see the same answer twice.

## A warm prompt cache

Anthropic keeps a prompt in cache for 5 minutes. While the agent waits for you, pi can send the last request again before then, so your next message reads the prompt from the cache instead of paying to write it again. On Opus 5.5, a refresh costs 5% of the input price, and a miss costs 125%.

By default, this package learns how long you usually take to answer, and refreshes only while that pays for itself. That keeps Opus 5.5 warm for about 23 minutes. Turn on pi's `cacheWarming` setting (`idle`) to use it.

## OpenAI-compatible endpoints

Add DeepInfra, a vLLM box, an Ollama server or any endpoint that speaks OpenAI's chat completions. In `/login`, pick `Sign in with an API key`, then `OpenAI-compatible endpoint`, and give it a name, a base URL and a key. Its chat models then show up in `/model`.

## Settings

These are in `~/.pi/agent/extensions/pi-harness/settings.json`, and on the Providers tab of `Alt+S`.

| Key                      | Default     | What it does                                                                             |
| ------------------------ | ----------- | ---------------------------------------------------------------------------------------- |
| `accounts.onLimit`       | `"ask"`     | What a quota or rate limit does when you have another account: `ask`, `switch` or `stop` |
| `accounts.onAuthFailure` | `"ask"`     | What a refused credential does: `ask` (sign in again or switch), `switch` or `stop`      |
| `cache.strategy`         | `"learned"` | How refreshes are decided: `learned`, `pi`, `minutes` or `off`                           |
| `cache.upTo`             | `20`        | How many minutes `minutes` keeps refreshing after the last request                       |

## Learn more

- [How it works](docs/how-it-works.md): what Anthropic checks before it bills the plan, accounts in detail, how the cache refresh is decided, and how endpoints are read.
- [Quota](docs/quota.md): where the numbers about what your plan has left come from.

The Claude plan billing comes from [pi-claude-max](https://github.com/bradennss/pi-claude-max), and several accounts per provider follow [pi-multiprovider](https://github.com/monotykamary/pi-multiprovider). Both are MIT.

<!-- docs:footer -->

<p align="center">
  <a href="https://adeildo.dev"><img src="https://adeildo.dev/assets/images/cat.svg" width="42" height="42" alt="adeildo.dev"></a><br>
  <a href="https://github.com/felipeadeildo/pi-harness">pi-harness</a> is made by <a href="https://adeildo.dev">adeildo.dev</a>
</p>

<!-- /docs -->
