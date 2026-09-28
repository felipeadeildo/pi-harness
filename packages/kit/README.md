# @adeildo/pi-kit

What every pi-harness package is built on. It's a library, not a Pi package, so installing it adds nothing to Pi.

## An app, and features in it

```ts
import { createApp, defineFeature, matching, setting } from "@adeildo/pi-kit";

export const version = setting({
	id: "subscription.claudeCodeVersion",
	default: "2.1.280",
	decoder: matching(/^\d+\.\d+\.\d+$/, "a version like 2.1.280"),
});

export const subscription = defineFeature({
	id: "subscription",
	settings: [version],
	setup(app) {
		app.pi.on("before_provider_headers", (event) => {
			event.headers["user-agent"] = `claude-cli/${version.get(app)}`;
		});
	},
});

export default (pi: ExtensionAPI) =>
	createApp(pi, { name: "pi-providers" }).use(subscription).build();
```

A package is one app. The harness will be one app with every feature, which Pi loads as a single extension.

The builder follows pi's extension docs, so features don't have to:

- `setup` only registers things. Work that lasts goes in `app.onSessionStart`, cleanup in `app.onShutdown`, and the builder runs cleanup once per session, newest first.
- The settings file is read when a session starts, before any feature's session hook runs.
- If `setup` throws, that feature becomes a warning. The others still mount.
- `app.warn` shows a notification when there's a UI, writes to stderr when there isn't, and holds the message until a session starts.
- If two apps in one Pi process both have the same feature, only the first one runs it and the second one says who has it. That covers installing the harness and a standalone package at the same time.

## Settings

Every app reads `~/.pi/agent/extensions/pi-harness/settings.json`. A setting's `id` is its path in that file. A store only reads the settings its own features declared, so keys from other apps never trigger a warning. `store.set` writes one value and leaves every other key alone.

A value that doesn't decode falls back to the default, and the warning names the file and the key.

## Events

```ts
const accountChanged = defineEvent("providers:account-changed", object({ account: string }));

accountChanged.on(app, ({ account }) => …);
accountChanged.emit(app, { account: "work" });
```

Events travel over `pi.events` on the channel `harness:<name>`, so two features work the same whether they share an app or come from different packages. The payload may come from an older or newer version of the other package, so it's decoded when it arrives. Anything that doesn't decode gets dropped with a warning. Payloads can gain fields but never lose them.

## Testing

`@adeildo/pi-kit/testing` has `fakePi()` and `fakeContext()`. Two fakes built on one `createEventBus()` act like two extensions in the same Pi process.

## License

[MIT](LICENSE)
