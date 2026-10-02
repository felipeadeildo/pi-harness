# @adeildo/pi-providers

[![npm](https://img.shields.io/npm/v/@adeildo/pi-providers)](https://www.npmjs.com/package/@adeildo/pi-providers)

Two features for the providers [Pi](https://pi.dev) talks to. `subscription` bills Anthropic requests to your Claude plan. `accounts` keeps several logins per provider and moves to the next one when a limit hits.

```bash
pi install npm:@adeildo/pi-providers
```

It also comes in [`@adeildo/pi-harness`](../harness), with the rest of the pieces.

## subscription

With a Claude Pro or Max plan connected through `/login anthropic`, Pi's requests count as paid extra usage. With `subscription` they come out of the plan, the way Claude Code's do.

> [!WARNING]
> This makes Pi introduce itself to Anthropic as Claude Code. Using your subscription from anything other than Claude Code may break Anthropic's terms. It is on once the package is installed, so decide whether you accept that risk. To turn it off, switch the extension off in `pi config`, or set `"features": { "subscription": { "enabled": false } }` in the settings file below.

Pi already sends Claude Code's identity with an OAuth token. Anthropic checks two more things before it bills a request to the plan:

1. The user agent has to read `claude-cli/<version> (external, cli)`.
2. The first `system` block has to be a billing attribution line, with nothing Claude Code would not send. So pi's own prompt moves to the start of the first user message, wrapped in `<system-instructions>`. The model still reads it there and follows it.

It acts on any provider that speaks the Anthropic Messages API with an OAuth token, not only the one named `anthropic`, so a second account registered under another name is billed to its own plan. Requests with an API key go out untouched.

Pi warns about extra usage on every Anthropic OAuth session. Once the plan pays, turn the warning off in `~/.pi/agent/settings.json`:

```json
{ "warnings": { "anthropicExtraUsage": false } }
```

When a request comes back with `400 claude_code_version_too_old`, raise the version Pi reports:

```json
{ "subscription": { "claudeCodeVersion": "2.1.280" } }
```

## accounts

Pi keeps one credential per provider, the one `/login` wrote. `accounts` keeps more. The credential of `/login` stays as `pi default`, and every other account is an extra credential with a name.

```text
/accounts anthropic
```

It picks the provider and its login method, asks for a name, and runs the login Pi already has, so no OAuth lives in this package. Each account shows its kind:

| Kind    | Is                                                                    |
| ------- | --------------------------------------------------------------------- |
| `login` | The credential of `/login`, which cannot be copied out of `auth.json` |
| `oauth` | A subscription token, billed to its own plan                          |
| `key`   | An API key                                                            |

`alt+a` switches the account of the current model's provider, and the Providers tab of `Alt+S` lists the accounts to choose, rename or remove. The account in use shows next to the model. The session remembers its choice, so a resume or a fork comes back with the same one.

When a request is refused for a quota or a rate limit and another account of that provider exists, `accounts.onLimit` decides what happens:

| Value    | Does                                                                       |
| -------- | -------------------------------------------------------------------------- |
| `ask`    | Opens a dialog, with the option to always switch from then on. The default |
| `switch` | Moves to the next account on its own                                       |
| `stop`   | Leaves the error in front of you                                           |

Only a limit that arrives before anything was shown switches, so the retry never repeats output you already saw. Only the chat streams move: image generation, classifier calls and deferred responses still use pi's own credential.

## Settings

In `~/.pi/agent/extensions/pi-harness/settings.json`:

| Key                              | Default     | Does                                                                                                   |
| -------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------ |
| `subscription.claudeCodeVersion` | `"2.1.280"` | The Claude Code version Pi reports. Anthropic will not serve newer models to versions it considers old |
| `accounts.onLimit`               | `"ask"`     | What a quota or rate limit does when another account exists: `"ask"`, `"switch"` or `"stop"`           |

## Credit

The idea and the fingerprint come from [pi-claude-max](https://github.com/bradennss/pi-claude-max) by Braden Lamb, MIT. This is a rewrite. It reads the version from settings, carries pi's cache breakpoints over instead of dropping the one-hour TTL, moves every system block after the identity instead of only the second, and checks for an OAuth token instead of the provider name.

## License

[MIT](LICENSE)
