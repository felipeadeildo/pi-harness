# Providers

Provider features for [Pi](https://pi.dev). For now it has one: `subscription`.

## subscription

With a Claude Pro or Max subscription connected through `/login anthropic`, Pi's requests count as paid extra usage. With this, they come out of the plan, the way Claude Code's do.

Pi already sends Claude Code's identity with an OAuth token. Anthropic also checks two more things before billing a request to the plan.

1. The user agent. It has to read `claude-cli/<version> (external, cli)`.
2. The `system` blocks. The first one has to be a billing attribution line, and there can't be anything Claude Code wouldn't send. So pi's own prompt moves to the start of the first user message, wrapped in `<system-instructions>`. The model still reads it there and follows it.

This works on any provider that uses the Anthropic Messages API with an OAuth token, not only the one called `anthropic`. A second account registered under another name gets billed to its plan too. Requests with an API key go out untouched.

Anthropic won't serve newer models to Claude Code versions it considers too old. When a request comes back with `400 claude_code_version_too_old`, raise the version in `~/.pi/agent/extensions/pi-harness/settings.json`:

```json
{
	"subscription": { "claudeCodeVersion": "2.1.280" }
}
```

Then turn off Pi's extra usage warning in `~/.pi/agent/settings.json`:

```json
{ "warnings": { "anthropicExtraUsage": false } }
```

> [!WARNING]
> This makes Pi introduce itself to Anthropic as Claude Code. Using your subscription from anything other than Claude Code may break Anthropic's terms. Decide whether you're fine with that risk before you turn it on.

## Credit

The idea and the fingerprint come from [pi-claude-max](https://github.com/bradennss/pi-claude-max) by Braden Lamb, MIT. This is a rewrite. It reads the version from settings, carries pi's cache breakpoints over instead of dropping the one-hour TTL, moves every system block after the identity instead of only the second, and checks for an OAuth token instead of the provider name.
