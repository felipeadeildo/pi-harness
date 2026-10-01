# Changelog

Every `@adeildo/` package in this repository shares one version, one tag and this changelog. The entries below 4.0.0 are from before, when `pi-ask-permission` was the only package.

## [5.0.0](https://github.com/felipeadeildo/pi-harness/compare/v4.1.0...v5.0.0) (2026-10-01)


### ⚠ BREAKING CHANGES

* **ask-permission:** set the judge with a model, a policy and a rigor, and let it read your last message
* one settings screen for every piece on Alt+S, in place of /perm and /look
* **ask-permission:** four modes, manual, edits, judge and full, with Alt+W for outside the workspace

### Features

* **ask-permission:** ask through the questions dialog, so both are one channel ([0ebcec2](https://github.com/felipeadeildo/pi-harness/commit/0ebcec283b409f7771505098803003d6353150c2))
* **ask-permission:** decide an MCP call by the policy of its server, and stop asking twice for a script ([08e3810](https://github.com/felipeadeildo/pi-harness/commit/08e38104297e274e05fa355155c532904d07af4b))
* **ask-permission:** four modes, manual, edits, judge and full, with Alt+W for outside the workspace ([3f0348a](https://github.com/felipeadeildo/pi-harness/commit/3f0348ab164f758ff470758dfc69b30daf0dc753))
* **ask-permission:** open a folder outside the workspace for reads, right from the dialog ([09cc796](https://github.com/felipeadeildo/pi-harness/commit/09cc79648768d888e1230d35f0fd5cca9e05dcd0))
* **ask-permission:** set the judge with a model, a policy and a rigor, and let it read your last message ([87014f3](https://github.com/felipeadeildo/pi-harness/commit/87014f3623604d8ed496b8e0a0645b05a1ed188f))
* **ask-questions:** ask with options, a preview of each, a note on any option and your own answer, in a dialog that scrolls ([95fc137](https://github.com/felipeadeildo/pi-harness/commit/95fc137404b348bb8f1c1774a4e7dda75f70c980))
* drop the middle dots from dialogs, hints and status, and default the footer separator to space ([a3814b4](https://github.com/felipeadeildo/pi-harness/commit/a3814b4cbd177579a46fbb548c8274ff59ce3096))
* **kit:** let a feature build screen rows when the screen opens, and say where a value applies ([4780365](https://github.com/felipeadeildo/pi-harness/commit/478036504ded26af3f90e382da56a1c93cd0c26e))
* **kit:** let a screen row sit indented under its section ([ae0b449](https://github.com/felipeadeildo/pi-harness/commit/ae0b449cc029dee21d932d91d5e0ed5bd9ec5bf7))
* **look:** name the state in the working line, in lower case, without repeating the call ([f689c2d](https://github.com/felipeadeildo/pi-harness/commit/f689c2d87be7701dd92aa8b379c6b98b8d23f6f8))
* **look:** place the account status next to the model ([4ef6328](https://github.com/felipeadeildo/pi-harness/commit/4ef632884a9c47681dfb30d4af9813909d5dc138))
* one settings screen for every piece on Alt+S, in place of /perm and /look ([9cc50c0](https://github.com/felipeadeildo/pi-harness/commit/9cc50c05650c900265d08d00e151f9053c21b34a))
* **providers:** add an account through the provider's own login, and pin it per session ([2e8ef4b](https://github.com/felipeadeildo/pi-harness/commit/2e8ef4b0497896ed6228cd48515f5523bad4f29e))
* **providers:** lift a provider per account, without duplicating its models ([133dd64](https://github.com/felipeadeildo/pi-harness/commit/133dd6492c62f261f30239e7f37787c35b64cf23))
* **providers:** manage accounts on the settings screen, and keep pi's credential as the default ([09049cf](https://github.com/felipeadeildo/pi-harness/commit/09049cfbe32c656c468c926ffc770360b684308d))
* **providers:** mark the current account in the picker, and report it as a status ([9413b9a](https://github.com/felipeadeildo/pi-harness/commit/9413b9a4830b8cda106558b677474012a2f58151))
* **providers:** read the accounts screen as a tree of provider, account and actions ([0a7e938](https://github.com/felipeadeildo/pi-harness/commit/0a7e938c116cd8954c7435f3b681ebd57b1de3a2))
* **providers:** switch to another account when one hits its limit ([5adbfb0](https://github.com/felipeadeildo/pi-harness/commit/5adbfb0a020d37d5a8a2b4c33509fb2f50a6f897))


### Bug Fixes

* **ask-permission:** read a bash command that sets a shell variable before it reads ([cd7da40](https://github.com/felipeadeildo/pi-harness/commit/cd7da405f5da4dfcbbc053013148b5a3c262a09a))
* **ask-permission:** show the MCP hints in the dialog, and keep the registered name in alwaysAsk ([b4cec5f](https://github.com/felipeadeildo/pi-harness/commit/b4cec5f53a65f11095293c9f6349400d15d9d5fb))
* **ask-permission:** trust a shell variable only where bash surely set it and nothing else can change it ([0387aa9](https://github.com/felipeadeildo/pi-harness/commit/0387aa9eab80cefc9dc5ceadd290aebbb7fbfe7c))
* **kit:** throw when a feature reads or writes a setting it never declared ([e8a9bc8](https://github.com/felipeadeildo/pi-harness/commit/e8a9bc81ccabd26c97ab0c00199926259668f766))
* **look:** time the wait from the request leaving, and count tokens with the ratio the session measured ([29e74b4](https://github.com/felipeadeildo/pi-harness/commit/29e74b471cd9ee6dd72a62ac99ec163f7ba96957))
* **providers:** delegate the lifted methods, keep the request signal, and stop caching the native ([4254a3d](https://github.com/felipeadeildo/pi-harness/commit/4254a3d6d677c541c5351b2600ceafeab9925a54))
* **providers:** keep a refreshed token on its own account, and one rule for the active one ([1e04718](https://github.com/felipeadeildo/pi-harness/commit/1e0471869ae515222fbc27ec557d998a8d43e5ca))
* **providers:** lift a provider when its first account arrives, not only at session start ([1068ef4](https://github.com/felipeadeildo/pi-harness/commit/1068ef48378a21fd2693afd2a1345e42a9dac17c))

## [4.1.0](https://github.com/felipeadeildo/pi-harness/compare/v4.0.0...v4.1.0) (2026-09-30)

### Features

* **harness:** `@adeildo/pi-harness` brings every piece: the permission dialog, the look and providers, one extension each, so `pi config` turns any of them off ([693b946](https://github.com/felipeadeildo/pi-harness/commit/693b9464149de87e375054f505891ee82ec8a8a1))
* **look, providers:** each piece is also a package of its own, `@adeildo/pi-look` and `@adeildo/pi-providers`, for whoever wants only that one. With a piece installed both ways, the first copy runs and the other stays off ([693b946](https://github.com/felipeadeildo/pi-harness/commit/693b9464149de87e375054f505891ee82ec8a8a1))

### Bug Fixes

* **release:** hand the terminal to npm so publish and trust can ask for 2FA ([45f0d3e](https://github.com/felipeadeildo/pi-harness/commit/45f0d3ef7881e1d3444dc57c0a70ea2c844dc98d))

## 4.0.0 (2026-09-30)

### ⚠ BREAKING CHANGES

* **ask-permission:** publish as `@adeildo/pi-ask-permission`. `pi-ask-permission` stays on npm at 3.0.0, deprecated. The config, the grants and the old sessions keep working ([dac6462](https://github.com/felipeadeildo/pi-harness/commit/dac646269680dbd7af76c7fd174b6d49ef7e7c19))
* **ask-permission:** read the config from the shared settings file ([0e9de2b](https://github.com/felipeadeildo/pi-harness/commit/0e9de2b4b779b010c1cfea07d0d736bf4ccd07b8))
* **look:** drop the prompt glyph in front of the editor, and the `look.frame.prompt` setting with it ([53fcfff](https://github.com/felipeadeildo/pi-harness/commit/53fcfff7758b7a1876ac2beb292949231922e926))

### Features

* **harness:** first release of `@adeildo/pi-harness`, with the look and providers as one extension each, so `pi config` turns either off ([64b24b2](https://github.com/felipeadeildo/pi-harness/commit/64b24b272d3e9b17e041dba070f6a935c3d16f79))
* **look:** replace the statusline with the whole look, from the start card to a framed editor ([f603bd2](https://github.com/felipeadeildo/pi-harness/commit/f603bd2010e7ea969b6bb341a2d63dc22e95c532))
* **look:** show the answer being written, its cost per million and the session speed ([71994d0](https://github.com/felipeadeildo/pi-harness/commit/71994d054f9b5dbe47114fed662488e6d295965c))
* **look:** give every effort level its own bar, paint the data and give every piece its own glyph ([b259aad](https://github.com/felipeadeildo/pi-harness/commit/b259aad8607f4f7941c9e3e85fb40338690ac25e))
* **look:** draw the git distance and the icons, and drop a zero cost ([8280954](https://github.com/felipeadeildo/pi-harness/commit/828095499d92a0af50b3fca451eaa75d9f6bb8de))
* **look:** show which pi version drew the line ([ad44468](https://github.com/felipeadeildo/pi-harness/commit/ad44468da2937bf4652a2bb05e0bc2af225306f5))
* **providers:** bill Anthropic OAuth requests to the Claude plan ([1a26543](https://github.com/felipeadeildo/pi-harness/commit/1a265438427054268429771156f3d83363d6d785))
* **kit:** add the app builder, settings and events that features are built on ([b5be12e](https://github.com/felipeadeildo/pi-harness/commit/b5be12e5145fcd7c99677bc83247675bbf359903))
* **kit:** give each feature its own scope, an on/off switch and project settings ([cb4eda4](https://github.com/felipeadeildo/pi-harness/commit/cb4eda4aaed4877bf66a4a364d357bddd3abe939))
* publish the workspace packages in dependency order, with a smoke test ([98f72d9](https://github.com/felipeadeildo/pi-harness/commit/98f72d97a313b8f6182e297e5b2444af0292038d))

### Bug Fixes

* **release:** refresh bun.lock on the release PR and refuse a stale workspace version ([e5656aa](https://github.com/felipeadeildo/pi-harness/commit/e5656aadcbce1e76a13c3b80429ab8dbe93151ca))

### Build

* the pi SDK is 0.99.1 ([33007a3](https://github.com/felipeadeildo/pi-harness/commit/33007a3b690e50bdeca3132d912105b4fb0d7f25))

## [3.0.0](https://github.com/felipeadeildo/pi-ask-permission/compare/v2.0.1...v3.0.0) (2026-09-23)


### ⚠ BREAKING CHANGES

* **commands:** suggest /perm arguments and rename reset to forget
* **config:** name each config key after its /perm row
* **workspace:** gate auto-approvals by project scope

### Features

* **commands:** suggest /perm arguments and rename reset to forget ([2cc932e](https://github.com/felipeadeildo/pi-ask-permission/commit/2cc932eef7a6e48adb775fec444be8d8782b4c6c))
* **config:** name each config key after its /perm row ([a9a2738](https://github.com/felipeadeildo/pi-ask-permission/commit/a9a273824e3d83b5a1903cf8c548df995f672e8f))
* **dialog:** show the diff an edit or write would make ([1222ca9](https://github.com/felipeadeildo/pi-ask-permission/commit/1222ca9dd3aa4bc30d53991de6cf79caced7e4d6))
* **events:** announce each decision and let other tools describe what they touch ([8dad96d](https://github.com/felipeadeildo/pi-ask-permission/commit/8dad96dc21fdad6f4b557743eceeb940d899add2))
* **readonly:** accept for loops and newline-separated commands ([8ce81bf](https://github.com/felipeadeildo/pi-ask-permission/commit/8ce81bf1d9f1c6da3b86cc0fe4240d08eeda70c0))
* **session:** keep the mode and this session's always yes across reloads and resumes ([264e815](https://github.com/felipeadeildo/pi-ask-permission/commit/264e815adf597cefd0c84b28e3f7e0eb07b0c12d))
* **workspace:** gate auto-approvals by project scope ([cfb7739](https://github.com/felipeadeildo/pi-ask-permission/commit/cfb773977b29950964a8be058963522f94dfcc3b))


### Bug Fixes

* **always-yes:** add to the saved file instead of overwriting it, now always-yes.json ([ede87d4](https://github.com/felipeadeildo/pi-ask-permission/commit/ede87d428810125cdf49bcf45f62ed2bbff88f85))
* **bash:** keep pi's shell settings in the timed bash override ([8bb8d2b](https://github.com/felipeadeildo/pi-ask-permission/commit/8bb8d2be0a04b88123b9fb409b168c746abc5e43))
* **config:** load config.json when a session starts, not when pi loads the extension ([79ddf75](https://github.com/felipeadeildo/pi-ask-permission/commit/79ddf75f4681318c2a6b4eb2fd2bfbdb9ea4c62f))
* **config:** replace the rename warnings with one info line ([dcbfdee](https://github.com/felipeadeildo/pi-ask-permission/commit/dcbfdeef5a0ca87ae59f219c71ada9d6cd979c78))
* **dialog:** put the title's space after the title, not before the corner ([1dce5a0](https://github.com/felipeadeildo/pi-ask-permission/commit/1dce5a084859a66b8b4b460f17e0e162f11d1b41))
* **workspace:** count powershell as outside and decide calls through tool adapters ([1216555](https://github.com/felipeadeildo/pi-ask-permission/commit/12165558c53d6834e1da09212484a97481119028))

## [2.0.1](https://github.com/felipeadeildo/pi-ask-permission/compare/v2.0.0...v2.0.1) (2026-09-21)


### Bug Fixes

* **readonly:** allow git branch and git remote listings ([0681ea4](https://github.com/felipeadeildo/pi-ask-permission/commit/0681ea4670f95d3547e17e4805bdf6561340e8bb))

## [2.0.0](https://github.com/felipeadeildo/pi-ask-permission/compare/v1.2.0...v2.0.0) (2026-09-21)


### ⚠ BREAKING CHANGES

* `yolo` is removed from config.json. Set `mode` to "manual", "accept-edits", or "yolo" instead.

### Features

* replace the persisted yolo flag with session modes ([3380e6c](https://github.com/felipeadeildo/pi-ask-permission/commit/3380e6ce760ef672c66621fecde2744b77a8aadd))


### Bug Fixes

* **readonly:** accept benign redirects, sed address ranges, and quoted substitutions ([fe4bb1e](https://github.com/felipeadeildo/pi-ask-permission/commit/fe4bb1e1cbb47200a71770ec5434c0430f76007d))

## [1.2.0](https://github.com/felipeadeildo/pi-ask-permission/compare/v1.1.0...v1.2.0) (2026-09-20)


### Features

* default AI approvals to a policy preset and show why the judge asked ([7843c43](https://github.com/felipeadeildo/pi-ask-permission/commit/7843c4351cb8cd600199e81db0d846c2cd078439))
* delegate approvals to a judge model ([51bb31b](https://github.com/felipeadeildo/pi-ask-permission/commit/51bb31b3d1c120d3a8d52ada32c17adbb248681f))
* show a card for every judge decision ([a429e71](https://github.com/felipeadeildo/pi-ask-permission/commit/a429e71fc203ba74a4a1c5287ffa99731093b84a))
* warn when AI approvals are on without a policy ([48dc772](https://github.com/felipeadeildo/pi-ask-permission/commit/48dc7727f8c6622b7f796079a53ec260644b7be6))


### Bug Fixes

* render judge entries persisted before per-turn grouping ([f0255d9](https://github.com/felipeadeildo/pi-ask-permission/commit/f0255d9f5c05b94df2c9e00b335de3d75919d688))
* show a judge card as soon as the judge decides ([cc84f6f](https://github.com/felipeadeildo/pi-ask-permission/commit/cc84f6f08fbe2c4f02cec044fd41c2a01cf467cd))
* size the judge card columns to the card itself ([a2a57a1](https://github.com/felipeadeildo/pi-ask-permission/commit/a2a57a11160154721136550ec4ca7b4ca0e91616))
* surface judge decisions and stop reporting rate limits as timeouts ([eb1f511](https://github.com/felipeadeildo/pi-ask-permission/commit/eb1f51194b93883f8fb21e32e23daff8c97960d4))

## [1.1.0](https://github.com/felipeadeildo/pi-ask-permission/compare/v1.0.1...v1.1.0) (2026-09-20)


### Features

* auto-allow read-only bash commands ([21c36a8](https://github.com/felipeadeildo/pi-ask-permission/commit/21c36a838196254d4dbf65be73bc2a791c04bff9))

## [1.0.1](https://github.com/felipeadeildo/pi-ask-permission/compare/v1.0.0...v1.0.1) (2026-09-20)


### Bug Fixes

* skip the generated changelog and allow a manual publish ([31f5478](https://github.com/felipeadeildo/pi-ask-permission/commit/31f5478868fd52130e19f01bbf4bbda58b14c7d7))

## 1.0.0 (2026-09-20)


### Features

* add pi-ask-permission, a three-way permission dialog with note followups ([55b603b](https://github.com/felipeadeildo/pi-ask-permission/commit/55b603b0e5c7ef049d4b614e7d3b6d89b9fcc12e))
* block an edit that cannot apply before the permission dialog ([5faaade](https://github.com/felipeadeildo/pi-ask-permission/commit/5faaadeaaad359a90dd4dede499e5536aeb2bafc))
* hold the dialog while the user is typing ([52fcfea](https://github.com/felipeadeildo/pi-ask-permission/commit/52fcfea4764e5d1042186d2c694516a8d7c683f2))
* keep a per-row note draft while arrowing the permission dialog ([84d684f](https://github.com/felipeadeildo/pi-ask-permission/commit/84d684ffdc246cd3f10a2fee68cfbfa12d75998f))
* paste images and long text into the permission note ([9dbc842](https://github.com/felipeadeildo/pi-ask-permission/commit/9dbc842110b70f13176e14c2e18ebbf2358548a8))
* scope always-yes grants to the session, the project, or everywhere ([d8aa4d2](https://github.com/felipeadeildo/pi-ask-permission/commit/d8aa4d23e12ec731d8f2102a1dffcd5fb2603147))


### Bug Fixes

* stop counting approval time in the bash Took line ([8e1a30c](https://github.com/felipeadeildo/pi-ask-permission/commit/8e1a30cfba7b9fea6ea5537ef24dd956c698e419))


### Miscellaneous Chores

* point the npm homepage at the pi gallery ([17e49bc](https://github.com/felipeadeildo/pi-ask-permission/commit/17e49bcfc02fb3737e65a2a0b7b534f4a66978c5))
