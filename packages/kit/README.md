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
	description: "Bill Anthropic OAuth requests to the Claude plan",
	settings: [version],
	setup(scope) {
		scope.on("before_provider_headers", (event) => {
			event.headers["user-agent"] = `claude-cli/${version.get(scope)}`;
		});
	},
});

export default function (pi: ExtensionAPI): void {
	createApp(pi, { name: "pi-providers" }).use(subscription).build();
}
```

A package is one app. The harness will be one app with every feature in it, and Pi loads it as a single extension.

## What a feature gets

`setup` receives the feature's scope. It extends `ExtensionAPI`, so it has every pi method, with two of them wired to the feature:

|                         |                                                                                                                                                                                                          |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scope.on`              | `pi.on`, but an error comes out as `pi-harness: permission: tool_call: boom` instead of just the extension's name. It's still thrown, because a `tool_call` handler that throws is how pi blocks a tool. |
| `scope.registerCommand` | `pi.registerCommand`. If another feature in the same app already took the name, this one is skipped with a warning.                                                                                      |
| `scope.onSessionStart`  | Runs once the session's settings are loaded. Anything that lasts, like a watcher, a server or a child process, starts here and never in `setup`.                                                         |
| `scope.onShutdown`      | Runs once per session, newest first, even when pi fires `session_shutdown` twice.                                                                                                                        |
| `scope.warn`            | Shows a notification when there's a UI and writes to stderr when there isn't. Messages sent before a session starts are held until it does.                                                              |
| everything else         | The scope **is** the extension API, so `scope.registerTool`, `scope.appendEntry`, `scope.events` and the rest work as they always did.                                                                   |

A feature whose `setup` throws turns into a warning, and the other features still mount. If the same feature runs in two apps of one Pi process, say the harness and a standalone package, the first app runs it and the second one logs who has it.

## Settings

Every app reads `~/.pi/agent/extensions/pi-harness/settings.json`. A setting's `id` is its path in that file. A store only reads the settings its own features declared, so keys that belong to other apps never produce a warning. `store.set` writes one value and leaves every other key alone.

A setting declared with `project: true` also reads `<project>/.pi/extensions/pi-harness/settings.json`, but only once pi trusts the project, and there the project value wins. Anything without that flag can only be set globally. A project file that tries to set it gets a warning, so a cloned repository can't loosen what runs without asking.

A value that fails to decode is ignored, and the warning names the file and the key.

Every feature also gets `features.<id>.enabled`, which defaults to on. A feature that's off never runs `setup`, so it registers nothing and costs nothing. The change takes effect on the next `/reload`.

## Events and contracts

```ts
const accountChanged = defineEvent("providers:account-changed", object({ account: string }));

accountChanged.on(scope, ({ account }) => …);
accountChanged.emit(scope, { account: "work" });
```

Events travel over `pi.events` on the channel `harness:<name>`. Two features behave the same whether they share an app or come from different packages. The payload might come from an older or newer version of the other package, so it's decoded when it arrives, and one that doesn't decode is dropped with a warning.

These rules hold for every event that crosses packages:

- It's declared in `contracts/` in this package, never in the package that emits it. That way the listener doesn't depend on the emitter, and either one works without the other.
- The payload is plain JSON, with no functions, classes or `Date`. A remote control or a web UI can then forward any contract without knowing what's inside.
- A payload can gain fields but never lose them.

## Testing

`@adeildo/pi-kit/testing` has `fakePi()` and `fakeContext()`. Two fakes built on one `createEventBus()` behave like two extensions in the same Pi process. `fire` runs the handlers in order and returns what each one returned.

## License

[MIT](LICENSE)
