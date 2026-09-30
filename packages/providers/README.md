# Providers

Part of [`@adeildo/pi-harness`](../README.md). It has one feature, `subscription`.

## subscription

With a Claude Pro or Max subscription connected through `/login anthropic`, Pi's requests count as paid extra usage. With `subscription`, they come out of the plan, the way Claude Code's do.

> [!WARNING]
> This makes Pi introduce itself to Anthropic as Claude Code. Using your subscription from anything other than Claude Code may break Anthropic's terms. It is on once the harness is installed, so decide whether you're fine with that risk. To turn it off, switch off the providers extension in `pi config`, or set `"features": { "subscription": { "enabled": false } }` in the settings file below.

Pi already sends Claude Code's identity with an OAuth token. Anthropic checks two more things before it bills a request to the plan.

1. The user agent. It has to read `claude-cli/<version> (external, cli)`.
2. The `system` blocks. The first one has to be a billing attribution line, and there can't be anything Claude Code wouldn't send. So pi's own prompt moves to the start of the first user message, wrapped in `<system-instructions>`. The model still reads it there and follows it.

It acts on any provider that uses the Anthropic Messages API with an OAuth token, not only the one called `anthropic`, so a second account registered under another name is billed to its own plan. Requests with an API key go out untouched.

Pi warns about extra usage on every Anthropic OAuth session. With the requests billed to the plan, turn the warning off in `~/.pi/agent/settings.json`:

```json
{ "warnings": { "anthropicExtraUsage": false } }
```

### Settings

In `~/.pi/agent/extensions/pi-harness/settings.json`:

| Key                              | Default     | Does                                                                                                    |
| -------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------- |
| `subscription.claudeCodeVersion` | `"2.1.280"` | The Claude Code version Pi reports. Anthropic won't serve newer models to versions it considers too old |

When a request comes back with `400 claude_code_version_too_old`, raise the version:

```json
{ "subscription": { "claudeCodeVersion": "2.1.280" } }
```

## Credit

The idea and the fingerprint come from [pi-claude-max](https://github.com/bradennss/pi-claude-max) by Braden Lamb, MIT. This is a rewrite. It reads the version from settings, carries pi's cache breakpoints over instead of dropping the one-hour TTL, moves every system block after the identity instead of only the second, and checks for an OAuth token instead of the provider name.
