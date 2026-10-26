# Changelog

Every `@adeildo/` package in this repository shares one version, one tag and this changelog. The entries below 4.0.0 are from before, when `pi-ask-permission` was the only package.

## [6.0.0](https://github.com/felipeadeildo/pi-harness/compare/v5.15.0...v6.0.0) (2026-10-26)


### ⚠ BREAKING CHANGES

* a session's handle is fixed, and pi's /name is the only /name ([#412](https://github.com/felipeadeildo/pi-harness/issues/412))
* **remote:** Expo leaves, and the daemon serves the Vite build as it is ([#411](https://github.com/felipeadeildo/pi-harness/issues/411))
* the harness is the whole install: the board's panel moves to the kit and the remote joins ([#408](https://github.com/felipeadeildo/pi-harness/issues/408))
* the tasks and their small model are gone, and the board takes their place ([#358](https://github.com/felipeadeildo/pi-harness/issues/358))

* a session's handle is fixed, and pi's /name is the only /name ([#412](https://github.com/felipeadeildo/pi-harness/issues/412)) ([09318af](https://github.com/felipeadeildo/pi-harness/commit/09318af0ef338d8b1bfce75b43b86d54a1602284))
* **remote:** Expo leaves, and the daemon serves the Vite build as it is ([#411](https://github.com/felipeadeildo/pi-harness/issues/411)) ([d722c0a](https://github.com/felipeadeildo/pi-harness/commit/d722c0a62d5b235db14d9d264ffbf41c56b602d8))
* the harness is the whole install: the board's panel moves to the kit and the remote joins ([#408](https://github.com/felipeadeildo/pi-harness/issues/408)) ([dd441dd](https://github.com/felipeadeildo/pi-harness/commit/dd441dde084cd9e23e8e4d1aabe3d254f58490b5))
* the tasks and their small model are gone, and the board takes their place ([#358](https://github.com/felipeadeildo/pi-harness/issues/358)) ([cbfb9b1](https://github.com/felipeadeildo/pi-harness/commit/cbfb9b1cd843eac4ce6f573005c75b270538ade6))


### Features

* **ask-questions:** ask the model's questions through the kit's bus ([#66](https://github.com/felipeadeildo/pi-harness/issues/66)) ([d42e502](https://github.com/felipeadeildo/pi-harness/commit/d42e5023bb868f00149efe65a78ec879c0ac3434))
* **ask-questions:** the questions are asked above the editor, which stays usable ([#298](https://github.com/felipeadeildo/pi-harness/issues/298)) ([a933c56](https://github.com/felipeadeildo/pi-harness/commit/a933c56ed64c8172abc0e053aef074c9a2f6e8f2))
* **ask:** the terminal says where a phone answered, and a phone's always yes lasts the session ([#302](https://github.com/felipeadeildo/pi-harness/issues/302)) ([85ba7ee](https://github.com/felipeadeildo/pi-harness/commit/85ba7ee4d761ebd8115a43c226f6d82c0237042c))
* **compact:** where the session stands comes from its board ([#377](https://github.com/felipeadeildo/pi-harness/issues/377)) ([d83bdba](https://github.com/felipeadeildo/pi-harness/commit/d83bdba93e7fa148da06bd6b4c53efb73e493054))
* **kit:** a board of deliverables, folded from its operations ([#201](https://github.com/felipeadeildo/pi-harness/issues/201)) ([75b2273](https://github.com/felipeadeildo/pi-harness/commit/75b2273c5c35ebee661caedd4759e053e9709d26))
* **kit:** a By type that says who caused a fact ([91bed4f](https://github.com/felipeadeildo/pi-harness/commit/91bed4fd0c78ad08e1164d53bc863164fd43d96e))
* **kit:** a question can be called off, tells the other side when it closes, and logs who answered ([94df242](https://github.com/felipeadeildo/pi-harness/commit/94df2427f556e7d9def82447afa709030fe5e7b7))
* **kit:** a rig runs a real pi session with a scripted model ([#65](https://github.com/felipeadeildo/pi-harness/issues/65)) ([9669943](https://github.com/felipeadeildo/pi-harness/commit/9669943e96efd0e7ea5304ed1b7a860bd92ef10d))
* **kit:** a session source, read from this pi or from its file as it grows ([#64](https://github.com/felipeadeildo/pi-harness/issues/64)) ([1712761](https://github.com/felipeadeildo/pi-harness/commit/171276180226018ab25d2252798f04f9fc97e830))
* **kit:** the board reads as lines with the column kept in place ([#338](https://github.com/felipeadeildo/pi-harness/issues/338)) ([25a2c24](https://github.com/felipeadeildo/pi-harness/commit/25a2c24a24ffe7514b598604d7661da0f0e59515))
* **kit:** the board, from its operations to the contract ([#256](https://github.com/felipeadeildo/pi-harness/issues/256)) ([6d8fbb2](https://github.com/felipeadeildo/pi-harness/commit/6d8fbb2595e3e1bf06fe6fab0386e11a30c914e6))
* **kit:** the inbox holds a follow-up until the agent settles, and the operator's words go first ([#132](https://github.com/felipeadeildo/pi-harness/issues/132)) ([5daca3b](https://github.com/felipeadeildo/pi-harness/commit/5daca3bb04b2ac9528203189cdb8bc4509d8e4f2))
* **kit:** the inbox stamps when a letter arrives, so the queue always has a time ([#135](https://github.com/felipeadeildo/pi-harness/issues/135)) ([2f6d472](https://github.com/felipeadeildo/pi-harness/commit/2f6d472d8d368b49f1b1b149c2335df231ef6126))
* **kit:** the row above the editor, and the permission asked in it ([#214](https://github.com/felipeadeildo/pi-harness/issues/214)) ([f96b2e5](https://github.com/felipeadeildo/pi-harness/commit/f96b2e5f982c731ec0a33c4dac51d8a09238d6ab))
* **kit:** work that belongs to the session, and stops when the session does ([#221](https://github.com/felipeadeildo/pi-harness/issues/221)) ([7af68a7](https://github.com/felipeadeildo/pi-harness/commit/7af68a7ea3e2e84b5df63f76e27cd32ce64a2ca9))
* **look:** the strip shows the session's board ([#381](https://github.com/felipeadeildo/pi-harness/issues/381)) ([9edfc1e](https://github.com/felipeadeildo/pi-harness/commit/9edfc1ee736ef90b55a224a05f6986d225aa12e2))
* **names:** each session draws the word the room calls it by ([#173](https://github.com/felipeadeildo/pi-harness/issues/173)) ([ad4042d](https://github.com/felipeadeildo/pi-harness/commit/ad4042d9d9dc7986b6b5396800a011ce3a76fa72))
* **peers:** a handle that moved keeps reaching the session it meant ([#272](https://github.com/felipeadeildo/pi-harness/issues/272)) ([7e63a40](https://github.com/felipeadeildo/pi-harness/commit/7e63a40db187fbc75e4088bfdafae0b34e33a5a0))
* **peers:** a room keeps each session's board by name, and merges nothing ([#346](https://github.com/felipeadeildo/pi-harness/issues/346)) ([146b727](https://github.com/felipeadeildo/pi-harness/commit/146b7271c82d783934aa45e208a10254fec9898a))
* **peers:** a room you only listen to ([#206](https://github.com/felipeadeildo/pi-harness/issues/206)) ([b6f772d](https://github.com/felipeadeildo/pi-harness/commit/b6f772d55c2ff7dc1341bf74d66d7e9d01028a3d))
* **peers:** a session can listen to a room without taking part in it ([#198](https://github.com/felipeadeildo/pi-harness/issues/198)) ([2ccc744](https://github.com/felipeadeildo/pi-harness/commit/2ccc74415c0b3022376be4cfa25cfe90cfb95c9d))
* **peers:** enter on an agent in Alt+G shows its session, and @ writes to it ([#90](https://github.com/felipeadeildo/pi-harness/issues/90)) ([9728857](https://github.com/felipeadeildo/pi-harness/commit/97288574ab58c45c92af2cafbd09e5f8e6434939))
* **peers:** the board is drawn in the room's own log ([#279](https://github.com/felipeadeildo/pi-harness/issues/279)) ([8615873](https://github.com/felipeadeildo/pi-harness/commit/8615873e5b6db9bb9f0130f3df95e7bdce222968))
* **peers:** the room reads each session's board ([#383](https://github.com/felipeadeildo/pi-harness/issues/383)) ([e6b5d7a](https://github.com/felipeadeildo/pi-harness/commit/e6b5d7a1ddc7302d7cf7837283e6c0c6f2f7d9d4))
* **remote-app:** a chosen row wears the terminal's three marks, and the accent is pi's ([#382](https://github.com/felipeadeildo/pi-harness/issues/382)) ([371aa8a](https://github.com/felipeadeildo/pi-harness/commit/371aa8aa8d761590dd361632673f6eed375eb651))
* **remote-app:** a command that waited can be sent now or dropped ([#178](https://github.com/felipeadeildo/pi-harness/issues/178)) ([2b5d651](https://github.com/felipeadeildo/pi-harness/commit/2b5d651ad2115cc9247049661226b5ac49c6a758))
* **remote-app:** a phone learns the daemon's address from the link that opened it ([#291](https://github.com/felipeadeildo/pi-harness/issues/291)) ([0c7f117](https://github.com/felipeadeildo/pi-harness/commit/0c7f117ecbf86a48364829b673d1e6f8d793ea28))
* **remote-app:** a prompt a client sent says where it was typed ([#356](https://github.com/felipeadeildo/pi-harness/issues/356)) ([1f8bcba](https://github.com/felipeadeildo/pi-harness/commit/1f8bcba2096de76fd266dc524d53023bf7fe8661))
* **remote-app:** controls draw SF Symbols on iOS and Material Symbols elsewhere ([#385](https://github.com/felipeadeildo/pi-harness/issues/385)) ([c9833ee](https://github.com/felipeadeildo/pi-harness/commit/c9833ee702ec67e8cdf2d4f146b6e25973050fb6))
* **remote-app:** draw text from elsewhere without interpreting it ([#99](https://github.com/felipeadeildo/pi-harness/issues/99)) ([ffffe5d](https://github.com/felipeadeildo/pi-harness/commit/ffffe5d51e9fac4e42fb6d69fb7d89d3acbf0bb1))
* **remote-app:** keep the session cache in SQLite on iOS and Android ([#288](https://github.com/felipeadeildo/pi-harness/issues/288)) ([5e9d7ba](https://github.com/felipeadeildo/pi-harness/commit/5e9d7ba481e1040a6d66aca2c056d201e3c50804))
* **remote-app:** the app follows the system's light and dark ([#369](https://github.com/felipeadeildo/pi-harness/issues/369)) ([be10603](https://github.com/felipeadeildo/pi-harness/commit/be1060397b1378ed2efa12af00423d5b3eff15a0))
* **remote-app:** the app has one theme, and a screen picks a step instead of a number ([#258](https://github.com/felipeadeildo/pi-harness/issues/258)) ([fe3e6a2](https://github.com/felipeadeildo/pi-harness/commit/fe3e6a2e0fc57217b0bf95a69e235389f099bcf2))
* **remote-app:** the app opens on the list, and a row opens the session ([#194](https://github.com/felipeadeildo/pi-harness/issues/194)) ([bd7cda9](https://github.com/felipeadeildo/pi-harness/commit/bd7cda982834d5892ef8948e094c7636131375f8))
* **remote-app:** the composer draws the controls the session serves, and what the queue is doing ([#161](https://github.com/felipeadeildo/pi-harness/issues/161)) ([a48e90d](https://github.com/felipeadeildo/pi-harness/commit/a48e90dc4f83a0890869ccedf4a9c96144629a7d))
* **remote-app:** the composer draws the state the session is in ([#196](https://github.com/felipeadeildo/pi-harness/issues/196)) ([00f6776](https://github.com/felipeadeildo/pi-harness/commit/00f677620e401f06134e8228e11ae79b64bfeaed))
* **remote-app:** the composer is React Native, and its controls reach a thumb ([#336](https://github.com/felipeadeildo/pi-harness/issues/336)) ([27b3a45](https://github.com/felipeadeildo/pi-harness/commit/27b3a45beb48438f43c42fe13c5541164e658e6a))
* **remote-app:** the exported app loads under the policy the daemon will serve ([#82](https://github.com/felipeadeildo/pi-harness/issues/82)) ([04be927](https://github.com/felipeadeildo/pi-harness/commit/04be927109bbb1c08773940406b8b3a6d08daa09))
* **remote-app:** the label of who speaks wears the accent and the agent's color, from names pi's theme gives ([#372](https://github.com/felipeadeildo/pi-harness/issues/372)) ([6c1d6f2](https://github.com/felipeadeildo/pi-harness/commit/6c1d6f25ef90ff60dbfc6c40024a4d7e4a794220))
* **remote-app:** the list of sessions, the ones that need you first ([#125](https://github.com/felipeadeildo/pi-harness/issues/125)) ([0e63968](https://github.com/felipeadeildo/pi-harness/commit/0e6396818f7f823dfc750341f41a091768af3d1b))
* **remote-app:** the model chip opens a sheet with a search, from a list the state can carry ([#359](https://github.com/felipeadeildo/pi-harness/issues/359)) ([fe9799b](https://github.com/felipeadeildo/pi-harness/commit/fe9799ba81996a989c3b6bd7a161dfc82ddcd70e))
* **remote-app:** the question is answered from the phone ([#202](https://github.com/felipeadeildo/pi-harness/issues/202)) ([f70571d](https://github.com/felipeadeildo/pi-harness/commit/f70571d8f6bcf0598bbf8bb7ffc5e3d36bbe8210))
* **remote-app:** the screen says when the terminal waits on a dialog it cannot answer ([#354](https://github.com/felipeadeildo/pi-harness/issues/354)) ([c01bd0f](https://github.com/felipeadeildo/pi-harness/commit/c01bd0f43f563d5caf6db81e84422e490719a6ac))
* **remote-app:** the session frame is React Native, and the document is a DOM component ([#296](https://github.com/felipeadeildo/pi-harness/issues/296)) ([6aa87e2](https://github.com/felipeadeildo/pi-harness/commit/6aa87e2ba3d49d8ffcdd27bbe6b996fb48f1a943))
* **remote-app:** the session route mounts the composer, and the client carries its own identity ([#162](https://github.com/felipeadeildo/pi-harness/issues/162)) ([8ce23a5](https://github.com/felipeadeildo/pi-harness/commit/8ce23a5c8d667cfa4e59c9b9272891a9993a75ef))
* **remote-app:** the session shows the board it keeps, in the order it arrived ([#366](https://github.com/felipeadeildo/pi-harness/issues/366)) ([a39c2bd](https://github.com/felipeadeildo/pi-harness/commit/a39c2bdd602d46497a4be4baad4a83dc9feb30e5))
* **remote-app:** trade the link's token for the login cookie before anything reads the address ([#137](https://github.com/felipeadeildo/pi-harness/issues/137)) ([28a75d3](https://github.com/felipeadeildo/pi-harness/commit/28a75d38f9a48f8837c795bb45918fac14e5c235))
* **remote-app:** typing a slash offers what the session says it can run ([#245](https://github.com/felipeadeildo/pi-harness/issues/245)) ([beaebaa](https://github.com/felipeadeildo/pi-harness/commit/beaebaab476893415036cf0f748a6b2a32a49c5b))
* **remote-client:** a command says which device sent it ([#160](https://github.com/felipeadeildo/pi-harness/issues/160)) ([4a3bdd0](https://github.com/felipeadeildo/pi-harness/commit/4a3bdd0c07abe1164f6a33520b7511e994010cbd))
* **remote-client:** a command typed on a dead socket goes out when it comes back ([#139](https://github.com/felipeadeildo/pi-harness/issues/139)) ([dc5d09a](https://github.com/felipeadeildo/pi-harness/commit/dc5d09a1a3930b67b07f0c83980bd5d0adae5c89))
* **remote-client:** presence arrives as it happens, and never from a replay ([#170](https://github.com/felipeadeildo/pi-harness/issues/170)) ([2c4aacd](https://github.com/felipeadeildo/pi-harness/commit/2c4aacd8bec4999154a4a1dca1f73f31900b9e2f))
* **remote-client:** read the daemon's session list ([#120](https://github.com/felipeadeildo/pi-harness/issues/120)) ([85e3458](https://github.com/felipeadeildo/pi-harness/commit/85e345828298e87ea54476c1b7f37d5f54a32890))
* **remote-client:** the commands typed while the daemon was away wait their turn ([#131](https://github.com/felipeadeildo/pi-harness/issues/131)) ([96c9205](https://github.com/felipeadeildo/pi-harness/commit/96c9205c885686bd97fdd18b7fc6fe03cb7abb62))
* **remote-protocol:** a queued letter says who wrote it and why it waits ([#133](https://github.com/felipeadeildo/pi-harness/issues/133)) ([bcbdf85](https://github.com/felipeadeildo/pi-harness/commit/bcbdf85285f3f482d394b0a7291911f0f8c2bf86))
* **remote-protocol:** a session says which slash commands a client may run ([#231](https://github.com/felipeadeildo/pi-harness/issues/231)) ([174d4aa](https://github.com/felipeadeildo/pi-harness/commit/174d4aa827179d259f8eb910f4619cb94515b558))
* **remote-protocol:** rebuild a session from the envelopes and facts it crossed a process in ([#68](https://github.com/felipeadeildo/pi-harness/issues/68)) ([17b3b83](https://github.com/felipeadeildo/pi-harness/commit/17b3b835b07e79a00bf7ea8971af119ddef76d3c))
* **remote:** a client sets the model, the thinking level and the mode, and hears when it cannot ([#138](https://github.com/felipeadeildo/pi-harness/issues/138)) ([c28817a](https://github.com/felipeadeildo/pi-harness/commit/c28817acb0a33c46b7c4e8da53b77022cdc976b3))
* **remote:** a client's answer to a question reaches the session that asked it ([#159](https://github.com/felipeadeildo/pi-harness/issues/159)) ([6ab2ebe](https://github.com/felipeadeildo/pi-harness/commit/6ab2ebeb3b9de880ca1d20f7c3a3c39546b48d52))
* **remote:** a client's command reaches its session, and the answer goes back to that client ([#145](https://github.com/felipeadeildo/pi-harness/issues/145)) ([abac0c7](https://github.com/felipeadeildo/pi-harness/commit/abac0c77b0955656d7ddaccf63f337142a89bea3))
* **remote:** a client's command runs in the session and is answered on its id ([#134](https://github.com/felipeadeildo/pi-harness/issues/134)) ([b872f90](https://github.com/felipeadeildo/pi-harness/commit/b872f90dc9807e12447c7f6471da25fa2c4bd187))
* **remote:** a key at the terminal makes it the session's active client ([#177](https://github.com/felipeadeildo/pi-harness/issues/177)) ([423e357](https://github.com/felipeadeildo/pi-harness/commit/423e357c5df6c11865cd62e557f096d7846428d4))
* **remote:** a prompt from a client says so in the terminal and in the log ([#166](https://github.com/felipeadeildo/pi-harness/issues/166)) ([7072c4c](https://github.com/felipeadeildo/pi-harness/commit/7072c4c8b38d4f65a73578624f90e344d64f2047))
* **remote:** a prompt goes through the inbox, and a follow-up waits for the agent to settle ([#149](https://github.com/felipeadeildo/pi-harness/issues/149)) ([aa96a6d](https://github.com/felipeadeildo/pi-harness/commit/aa96a6d76eca2fd86c868d8204d066691e091456))
* **remote:** a prompt that no run started says so, and a late start clears it ([#232](https://github.com/felipeadeildo/pi-harness/issues/232)) ([d40656c](https://github.com/felipeadeildo/pi-harness/commit/d40656c13015eadde6df4da8b9d14befa029e847))
* **remote:** a session says it takes a mode, which is a capability and not a value ([#300](https://github.com/felipeadeildo/pi-harness/issues/300)) ([cefcb6e](https://github.com/felipeadeildo/pi-harness/commit/cefcb6e87d5d363729fb49e3cb6187b876024027))
* **remote:** a session says who has it open, and whose input came last ([#171](https://github.com/felipeadeildo/pi-harness/issues/171)) ([8bf9bd8](https://github.com/felipeadeildo/pi-harness/commit/8bf9bd840a6a7a1509a19ad59af7bdcb9b4ec736))
* **remote:** a session with no terminal asks through the clients ([#136](https://github.com/felipeadeildo/pi-harness/issues/136)) ([847f0c0](https://github.com/felipeadeildo/pi-harness/commit/847f0c09b66e75b193ab21fd42a8e736e6c75175))
* **remote:** a stop closes the questions the session still has open ([#150](https://github.com/felipeadeildo/pi-harness/issues/150)) ([b87932c](https://github.com/felipeadeildo/pi-harness/commit/b87932ce9b87387daa6d47de97f94fa18f41eefb))
* **remote:** clients are told when the terminal waits on custom() or the editor ([#314](https://github.com/felipeadeildo/pi-harness/issues/314)) ([862490e](https://github.com/felipeadeildo/pi-harness/commit/862490ed47af89d2e9e18ccdf8083d63c58f5f56))
* **remote:** clients race the terminal for select, confirm and input ([#310](https://github.com/felipeadeildo/pi-harness/issues/310)) ([4198501](https://github.com/felipeadeildo/pi-harness/commit/4198501bc3ccbeed19882c235c02bf1faff47ca6))
* **remote:** the board a session keeps travels as its third producer ([#365](https://github.com/felipeadeildo/pi-harness/issues/365)) ([23a3b2e](https://github.com/felipeadeildo/pi-harness/commit/23a3b2e0eda4c5e1a413a927157f86750f37cd42))
* **remote:** the bridge says which client a prompt came from, once it is sure ([#355](https://github.com/felipeadeildo/pi-harness/issues/355)) ([927c1d5](https://github.com/felipeadeildo/pi-harness/commit/927c1d5a9778501ccbb9821de482d0f5d38a35d0))
* **remote:** the daemon answers on the machine's tailnet, and the owner's devices log in by who they are ([#403](https://github.com/felipeadeildo/pi-harness/issues/403)) ([dba9192](https://github.com/felipeadeildo/pi-harness/commit/dba9192a7ca5a7b74293271bc3dc81e1052c60a4))
* **remote:** the daemon serves the page, with the session route, the composer and the question in React ([#410](https://github.com/felipeadeildo/pi-harness/issues/410)) ([a208480](https://github.com/felipeadeildo/pi-harness/commit/a20848066f7b1f363e83b904df42b51cc52938b9))
* **remote:** the daemon serves the web app from the build's own list ([#128](https://github.com/felipeadeildo/pi-harness/issues/128)) ([738fe14](https://github.com/felipeadeildo/pi-harness/commit/738fe140418b8d5380080067186290142c9ef15d))
* **remote:** the file that says who holds the socket also says the pid ([#230](https://github.com/felipeadeildo/pi-harness/issues/230)) ([bd339ec](https://github.com/felipeadeildo/pi-harness/commit/bd339ecfa5a756f7357d9a9fea5211085def194c))
* **remote:** the opening carries the model and the thinking level ([#368](https://github.com/felipeadeildo/pi-harness/issues/368)) ([9fd625d](https://github.com/felipeadeildo/pi-harness/commit/9fd625ddd26a56192d4ddc4f2227776126ae710b))
* **remote:** the owner's machines work as one: one address, and rooms across machines ([#413](https://github.com/felipeadeildo/pi-harness/issues/413)) ([6b044fa](https://github.com/felipeadeildo/pi-harness/commit/6b044fa15f3656b5d3d7ef12ed8e9cfe0303a309))
* **remote:** the page lists sessions by machine with the terminal's marks, and a session wears its name in a bar ([#415](https://github.com/felipeadeildo/pi-harness/issues/415)) ([ca103f9](https://github.com/felipeadeildo/pi-harness/commit/ca103f905c9ff7af0a6be17b523c68bb14780670))
* **remote:** the page's project, with Vite, React Router and the list of sessions ([#407](https://github.com/felipeadeildo/pi-harness/issues/407)) ([fc70340](https://github.com/felipeadeildo/pi-harness/commit/fc703403aade2ad8767b498e2c82c64fdf5e2b90))
* **remote:** the phone knows the theme's accent and the color the room gave the session ([#370](https://github.com/felipeadeildo/pi-harness/issues/370)) ([fce9625](https://github.com/felipeadeildo/pi-harness/commit/fce962509c158aea45d5eb9a621a830cadb063d5))
* **remote:** the port clients reach the daemon on is a setting ([#197](https://github.com/felipeadeildo/pi-harness/issues/197)) ([618a638](https://github.com/felipeadeildo/pi-harness/commit/618a63843816d8f4e106f9c574a8cd78cd16088e))
* **remote:** the send decides a slash command before pi sees the text ([#261](https://github.com/felipeadeildo/pi-harness/issues/261)) ([c457194](https://github.com/felipeadeildo/pi-harness/commit/c4571940a18d9e976ab64554a71e985d24784455))


### Bug Fixes

* **kit:** a dialog above the editor reads each key once, not its release too ([#401](https://github.com/felipeadeildo/pi-harness/issues/401)) ([8b13a58](https://github.com/felipeadeildo/pi-harness/commit/8b13a58335ef68e685bcc0fb55d0d3a313a2e081))
* **kit:** a host with no input to listen to is not asked to watch the editor ([#271](https://github.com/felipeadeildo/pi-harness/issues/271)) ([6e29095](https://github.com/felipeadeildo/pi-harness/commit/6e29095c64e88197c5748129668213c714d1b1b6))
* **kit:** the board tool's schema is an object at the top, which every provider requires ([#404](https://github.com/felipeadeildo/pi-harness/issues/404)) ([5adc4e3](https://github.com/felipeadeildo/pi-harness/commit/5adc4e3d818322550f3117414e62d754c76b8f8b))
* **peers:** drop a session whose pid another process got ([#67](https://github.com/felipeadeildo/pi-harness/issues/67)) ([9341901](https://github.com/felipeadeildo/pi-harness/commit/934190180a926aea947925a50fc5d3420c0d432f))
* **peers:** keep the handle and the title when a session is named in two events ([#86](https://github.com/felipeadeildo/pi-harness/issues/86)) ([e3c89c8](https://github.com/felipeadeildo/pi-harness/commit/e3c89c8687c61949779e33cdb795037952a9cff9))
* **peers:** let agents answer each other up to a chain limit you set, and say when a held message went in with a run you did not start ([#81](https://github.com/felipeadeildo/pi-harness/issues/81)) ([97d0aa4](https://github.com/felipeadeildo/pi-harness/commit/97d0aa409809a29c28e2057cac94d3bb13d607e2))
* **peers:** only what waits for this session takes the line over the editor ([#212](https://github.com/felipeadeildo/pi-harness/issues/212)) ([7084858](https://github.com/felipeadeildo/pi-harness/commit/708485801f5de93a1b8bf664b7383a3cdf007057))
* **peers:** reuse a tool row's component instead of chaining every one it drew ([#96](https://github.com/felipeadeildo/pi-harness/issues/96)) ([2afe144](https://github.com/felipeadeildo/pi-harness/commit/2afe1440e2f3dabd122b07c237266211dca3d517))
* **remote-app:** a command that waited says it waits for you ([#185](https://github.com/felipeadeildo/pi-harness/issues/185)) ([a96e3ef](https://github.com/felipeadeildo/pi-harness/commit/a96e3ef1a20de8bda40332f14f976e59722cf1da))
* **remote-app:** Enter sends the draft ([#222](https://github.com/felipeadeildo/pi-harness/issues/222)) ([6f5634d](https://github.com/felipeadeildo/pi-harness/commit/6f5634dfee6677bfeaec6f9eaaad154574d41554))
* **remote-app:** the composer hears the queue, owns its draft, and offers every thinking level ([#165](https://github.com/felipeadeildo/pi-harness/issues/165)) ([cf8ad50](https://github.com/felipeadeildo/pi-harness/commit/cf8ad50d0c2801986d4e1fc19b3e3aaf61631f20))
* **remote-app:** the document exports one thing, so Android can bundle it ([#353](https://github.com/felipeadeildo/pi-harness/issues/353)) ([124e844](https://github.com/felipeadeildo/pi-harness/commit/124e8441842fb86c7adbbba46a5eb75532630d25))
* **remote-app:** the document takes the theme's type, and sizes itself on a phone ([#337](https://github.com/felipeadeildo/pi-harness/issues/337)) ([84e443a](https://github.com/felipeadeildo/pi-harness/commit/84e443a74bdc61c7bfcb7722b54d9249615acc97))
* **remote-app:** the header says the status, not the folded state ([#242](https://github.com/felipeadeildo/pi-harness/issues/242)) ([df88ea6](https://github.com/felipeadeildo/pi-harness/commit/df88ea636172823418758823e7c1c8419e767c73))
* **remote-app:** the list draws instead of throwing before the first row ([#211](https://github.com/felipeadeildo/pi-harness/issues/211)) ([62f92c6](https://github.com/felipeadeildo/pi-harness/commit/62f92c6a5a6c26b49ce67e703202d44803c39510))
* **remote-app:** the mode dial asks the session whether it serves the mode ([#329](https://github.com/felipeadeildo/pi-harness/issues/329)) ([38f0f29](https://github.com/felipeadeildo/pi-harness/commit/38f0f29720e8e3fd8886f5729f682a832b23e070))
* **remote-app:** the mode dial follows the capability, not the value ([#316](https://github.com/felipeadeildo/pi-harness/issues/316)) ([53f5883](https://github.com/felipeadeildo/pi-harness/commit/53f588318ee6a60b2b0786043b379a867d5355fd))
* **remote-app:** the mode dial is drawn again after a daemon restart, by undoing [#316](https://github.com/felipeadeildo/pi-harness/issues/316) ([#324](https://github.com/felipeadeildo/pi-harness/issues/324)) ([89a3ee2](https://github.com/felipeadeildo/pi-harness/commit/89a3ee27e2a6cc6714f1b7322800fb4594f746ac))
* **remote-app:** the pickers read the session's state, not the snapshot's photograph ([#248](https://github.com/felipeadeildo/pi-harness/issues/248)) ([82f1e91](https://github.com/felipeadeildo/pi-harness/commit/82f1e91648292d0c770387555d829507ea468ca4))
* **remote-app:** the question panel keeps its height under the thumb ([#209](https://github.com/felipeadeildo/pi-harness/issues/209)) ([ad3ebed](https://github.com/felipeadeildo/pi-harness/commit/ad3ebed4eb6185f9a56d02d9f3107bfd192a6267))
* **remote-app:** the session's queue reaches the composer ([#235](https://github.com/felipeadeildo/pi-harness/issues/235)) ([404d474](https://github.com/felipeadeildo/pi-harness/commit/404d474db80fbdce5cb82669ee5818f0f84c77aa))
* **remote-client:** a list nothing decodes is an error, and the request can be given up on ([#123](https://github.com/felipeadeildo/pi-harness/issues/123)) ([26ca199](https://github.com/felipeadeildo/pi-harness/commit/26ca199794ee31a32ef96e66b0e515e2672d0674))
* **remote-client:** draw the branch the bridge names, including the root ([#102](https://github.com/felipeadeildo/pi-harness/issues/102)) ([fe76d88](https://github.com/felipeadeildo/pi-harness/commit/fe76d88bd3e548793b056e7040fc48a3e684e6a1))
* **remote-client:** Send now puts the held command on the wire ([#190](https://github.com/felipeadeildo/pi-harness/issues/190)) ([c9128cf](https://github.com/felipeadeildo/pi-harness/commit/c9128cfff5abb1b260ec3ab4ef12fb3ee347a656))
* **remote-client:** the cache keeps who was watching, never who was typing ([#176](https://github.com/felipeadeildo/pi-harness/issues/176)) ([ae4ddcc](https://github.com/felipeadeildo/pi-harness/commit/ae4ddcc2073aac1733ad003fff54faaef1929f4a))
* **remote-client:** the client reads the state the opening carries, from where the bridge writes it ([#364](https://github.com/felipeadeildo/pi-harness/issues/364)) ([32bb6c3](https://github.com/felipeadeildo/pi-harness/commit/32bb6c3d797fa8c79e3d406c401af663709db501))
* **remote-client:** the queue a tab typed survives the tab ([#204](https://github.com/felipeadeildo/pi-harness/issues/204)) ([1adc73c](https://github.com/felipeadeildo/pi-harness/commit/1adc73cd3e810e4fbcf33a747eb8b8fb644f66dd))
* **remote-protocol:** a stream is a number, and a leaf can be the root ([#94](https://github.com/felipeadeildo/pi-harness/issues/94)) ([fa17cdc](https://github.com/felipeadeildo/pi-harness/commit/fa17cdc9478f73cb5a48f7305cad1cff229debe0))
* **remote:** a compaction that ends after its session is gone drains nothing ([#218](https://github.com/felipeadeildo/pi-harness/issues/218)) ([4b90899](https://github.com/felipeadeildo/pi-harness/commit/4b90899ee6a706cba5e3627bf8a95583a43608b8))
* **remote:** a compaction that ends lets the held follow-up in ([#203](https://github.com/felipeadeildo/pi-harness/issues/203)) ([db91346](https://github.com/felipeadeildo/pi-harness/commit/db91346496f3eac4c693b67c5d1796078640f61c))
* **remote:** a frame with an extension bit, or a control frame too big, is refused ([#205](https://github.com/felipeadeildo/pi-harness/issues/205)) ([4cf4de2](https://github.com/felipeadeildo/pi-harness/commit/4cf4de2616b77726348dbf97b1bd26e6bb02a6a7))
* **remote:** a prompt into an idle session starts the run instead of waiting for a settle ([#188](https://github.com/felipeadeildo/pi-harness/issues/188)) ([8f004c4](https://github.com/felipeadeildo/pi-harness/commit/8f004c4cf0cc047a822a778bdadd4fc37224a661))
* **remote:** a prompt leaves the queue when pi starts the run, not when the send returns ([#226](https://github.com/felipeadeildo/pi-harness/issues/226)) ([11cbaff](https://github.com/felipeadeildo/pi-harness/commit/11cbaff15cbb9f0e44f0af084834279ffb15b52f))
* **remote:** a session that said nothing about the mode is not a session that refuses it ([#325](https://github.com/felipeadeildo/pi-harness/issues/325)) ([c15c6b7](https://github.com/felipeadeildo/pi-harness/commit/c15c6b78cb5a362b8bb58662eaff879cc1bb0dc2))
* **remote:** one producer per question fact, and a closed answer that keeps its author ([#187](https://github.com/felipeadeildo/pi-harness/issues/187)) ([15b94e3](https://github.com/felipeadeildo/pi-harness/commit/15b94e37e418fd1212e8ea3e7464b5c939bf0352))
* **remote:** pi-remote serve finds the web app's export, as the daemon entry does ([#130](https://github.com/felipeadeildo/pi-harness/issues/130)) ([5812d41](https://github.com/felipeadeildo/pi-harness/commit/5812d418f140fcca01282f722f2c2b235f6e577f))
* **remote:** streamed deltas take no number, so a replay has no gap ([#124](https://github.com/felipeadeildo/pi-harness/issues/124)) ([f202876](https://github.com/felipeadeildo/pi-harness/commit/f202876a7705e8463b4d9803c697f605a4d3f01e))
* **remote:** the command reads the port where pi writes it, which is nested ([#225](https://github.com/felipeadeildo/pi-harness/issues/225)) ([57abab6](https://github.com/felipeadeildo/pi-harness/commit/57abab68dac1dcd8bc06816948e7854c91b6b3e4))
* **remote:** the daemon sends the state to a client that waited for the bridge ([#252](https://github.com/felipeadeildo/pi-harness/issues/252)) ([1a6bac6](https://github.com/felipeadeildo/pi-harness/commit/1a6bac626c837de553e671c1a0593e7e319e342d))
* **remote:** the heartbeat keeps one mechanism, and the live-peer test has room to answer ([#247](https://github.com/felipeadeildo/pi-harness/issues/247)) ([4a1db36](https://github.com/felipeadeildo/pi-harness/commit/4a1db361d24bcf50a2738dd717b634f2e49e3d11))
* **remote:** the list reads the summary the daemon sends, so a row has its handle and its status ([#414](https://github.com/felipeadeildo/pi-harness/issues/414)) ([6c3c0d0](https://github.com/felipeadeildo/pi-harness/commit/6c3c0d05d5da2085719eda2a5d8ba46f3c55f9a4))
* **remote:** the opening carries the daemon's fold when the snapshot brings none ([#344](https://github.com/felipeadeildo/pi-harness/issues/344)) ([59e37a4](https://github.com/felipeadeildo/pi-harness/commit/59e37a4ce9cbcf4e3d6fce7c35dafa5f829e298b))
* **remote:** the opening carries what the session spent, so a reconnect does not lose it ([#360](https://github.com/felipeadeildo/pi-harness/issues/360)) ([43a3e1f](https://github.com/felipeadeildo/pi-harness/commit/43a3e1f096609a8f261921595b657ede583ecaa3))
* **tooling:** keep the installed skills out of lint and format ([#95](https://github.com/felipeadeildo/pi-harness/issues/95)) ([414e4d6](https://github.com/felipeadeildo/pi-harness/commit/414e4d60efd75962717687f194a4af882a162daf))


### Performance Improvements

* **peers:** work out who is open once per folder change or second, and keep a receipt's lines until they change ([#97](https://github.com/felipeadeildo/pi-harness/issues/97)) ([c9d2d0a](https://github.com/felipeadeildo/pi-harness/commit/c9d2d0a9cf4e75e74407d9ebab485a8a41597517))

## [5.15.0](https://github.com/felipeadeildo/pi-harness/compare/v5.14.0...v5.15.0) (2026-10-23)


### Features

* **peers:** keep a colleague's message over the editor until the agent reads it, and hold it for the next prompt when Esc empties the queue ([d74a9c6](https://github.com/felipeadeildo/pi-harness/commit/d74a9c6446d02935bdfe6a0a317d33818a026fc5))

## [5.14.0](https://github.com/felipeadeildo/pi-harness/compare/v5.13.0...v5.14.0) (2026-10-23)


### Features

* **ask-questions:** answer the options already whole while the model writes, each lighting up as it arrives ([3535037](https://github.com/felipeadeildo/pi-harness/commit/353503726e002a7c1681f66d8a88d2f2a48d755f))
* **ask-questions:** the dialog opens while the model writes, so you answer as the questions arrive ([a26102c](https://github.com/felipeadeildo/pi-harness/commit/a26102c670f422f6b014b3287cff15999ba360e2))

## [5.13.0](https://github.com/felipeadeildo/pi-harness/compare/v5.12.2...v5.13.0) (2026-10-23)


### Features

* **peers:** a shared room ends when nobody uses it, and Alt+G lists and removes its folders ([44ab693](https://github.com/felipeadeildo/pi-harness/commit/44ab693de071308de4afb8409f4d5b376d6474c0))


### Bug Fixes

* **peers:** [@everyone](https://github.com/everyone) from the chat reaches the shared rooms too ([7a59028](https://github.com/felipeadeildo/pi-harness/commit/7a5902838c85e750a3503576be7d68b0a77a9856))

## [5.12.2](https://github.com/felipeadeildo/pi-harness/compare/v5.12.1...v5.12.2) (2026-10-22)


### Bug Fixes

* **peers:** the footer counts only what arrived after the session opened ([6b6d8eb](https://github.com/felipeadeildo/pi-harness/commit/6b6d8eb62f504427ccd17f9ce475bf695c7c4c80))

## [5.12.1](https://github.com/felipeadeildo/pi-harness/compare/v5.12.0...v5.12.1) (2026-10-22)


### Bug Fixes

* **providers:** the Claude Code eval captures the turn api.anthropic.com gets ([edea84a](https://github.com/felipeadeildo/pi-harness/commit/edea84aa7e9b4dd3d8cdb5a63dec862f29343675))

## [5.12.0](https://github.com/felipeadeildo/pi-harness/compare/v5.11.2...v5.12.0) (2026-10-21)


### Features

* **kit:** the frame draws a line of tabs under its top edge, and the column line starts under them ([7d94634](https://github.com/felipeadeildo/pi-harness/commit/7d94634f0fa41ebcd8c34a1ce35fb5ea2ce2cff5))
* **look:** shared rooms' agents follow the folder's after a rule ([72f262b](https://github.com/felipeadeildo/pi-harness/commit/72f262b0f6bd3dd1f5aba45e2af6f9f34c6f6304))
* **peers:** a tab per room in Alt+G, and a rooms tab to make and change them ([74152f2](https://github.com/felipeadeildo/pi-harness/commit/74152f267a5fa781f7f9f30cbf4e8055837c337b))
* **peers:** Alt+G opens the rooms again ([69ad9e0](https://github.com/felipeadeildo/pi-harness/commit/69ad9e0c3f4ff8e0aa3b899c1e2cc13c61bb6fd0))
* **peers:** Alt+R opens the rooms ([9bb6edb](https://github.com/felipeadeildo/pi-harness/commit/9bb6edb94ebd47089f412bde97a25c6f110e631e))
* **peers:** receipts for [@everyone](https://github.com/everyone) fan out per agent, and [@anyone](https://github.com/anyone) shows its bids live ([b25b3e8](https://github.com/felipeadeildo/pi-harness/commit/b25b3e83f9c9fae22db604c8d1ee5f5a2077235e))
* **peers:** receipts read the room the message went to ([b47ddc5](https://github.com/felipeadeildo/pi-harness/commit/b47ddc556e9789ed66a9682a99ffb84d70478f6e))
* **peers:** sessions join shared rooms across folders, and an agent can ask for one ([74e8ab5](https://github.com/felipeadeildo/pi-harness/commit/74e8ab54d2f389ca84e3682b96352c74ba7ea2ca))
* **peers:** the contract of shared rooms, the events that fold them and the view the screen reads ([6e0340c](https://github.com/felipeadeildo/pi-harness/commit/6e0340caf6b63f973e76f1d591ceef692f85687d))
* **peers:** the rooms panel fills the screen, with the rooms on the left and no box per message ([74f24d2](https://github.com/felipeadeildo/pi-harness/commit/74f24d2663b67ec7c09f59f71f2c9bb5b972acdf))


### Bug Fixes

* **kit:** keys that only fit across the bottom edge run under the column ([992a8a8](https://github.com/felipeadeildo/pi-harness/commit/992a8a89ffad2025d5751fa0afa50a4bc734d9a0))
* **peers:** a new session gets nothing sent before it opened, and wakes only after your first prompt ([1ab8709](https://github.com/felipeadeildo/pi-harness/commit/1ab87094542ede2d1daf779b3cc7dcbd01f9a673))
* **peers:** agents talking during your run no longer trip the loop brake, and held messages show right away ([48567a5](https://github.com/felipeadeildo/pi-harness/commit/48567a55b5cd17645376fb1f6229a3676633f942))
* **providers:** the Claude Code eval no longer reads href="thumb.png" as the OAuth beta ([70ac80d](https://github.com/felipeadeildo/pi-harness/commit/70ac80db0ee3e745fc72221ea6e4ffe321ca9eca))


### Performance Improvements

* **peers:** a closed room is read once, then left alone ([2a6f83c](https://github.com/felipeadeildo/pi-harness/commit/2a6f83cc6c8189af65eb5b4572ea3d31d475ddef))

## [5.11.2](https://github.com/felipeadeildo/pi-harness/compare/v5.11.1...v5.11.2) (2026-10-19)


### Bug Fixes

* **providers:** the OpenAI-compatible API comes from pi-ai/compat, the subpath Pi maps into extensions ([57b0727](https://github.com/felipeadeildo/pi-harness/commit/57b072750a8a3fbfea59125ea50792d3b17e792e))
* **scripts:** the smoke installs without peers, like Pi does, so an unmapped host import fails here first ([92b499c](https://github.com/felipeadeildo/pi-harness/commit/92b499c00faab463366b5086c876d7119b170e89))

## [5.11.1](https://github.com/felipeadeildo/pi-harness/compare/v5.11.0...v5.11.1) (2026-10-19)


### Bug Fixes

* **look:** each call stops writing when the model ends it, and the write/edit stream survives any argument order ([b5bd220](https://github.com/felipeadeildo/pi-harness/commit/b5bd220ad72229410a7b46769abbe9df0405ac5b))
* **scripts:** the bump branch is pushed with --force, since the shallow checkout has no lease to compare against ([3b97fdf](https://github.com/felipeadeildo/pi-harness/commit/3b97fdfe4430ad908545223412967186664fa1da))

## [5.11.0](https://github.com/felipeadeildo/pi-harness/compare/v5.10.1...v5.11.0) (2026-10-16)


### Features

* **providers:** OpenAI-compatible endpoints are added from /login, with their models read from the endpoint ([7393967](https://github.com/felipeadeildo/pi-harness/commit/7393967e6c3dfa793b7af6ef6fcd127ecc4189b3))

## [5.10.1](https://github.com/felipeadeildo/pi-harness/compare/v5.10.0...v5.10.1) (2026-10-15)


### Bug Fixes

* **docs:** the pictures pin the harness version, so a release no longer makes them stale ([376a5f6](https://github.com/felipeadeildo/pi-harness/commit/376a5f6f8dd3a638b5f5e295d2c54a9a59117c6a))
* **providers:** the Claude Code eval reads the feature factory's name off the build, since 2.1.301 renamed it ([a0fb1fd](https://github.com/felipeadeildo/pi-harness/commit/a0fb1fd7ff818d999cf915c171cf19c8ab90dd76))
* **release:** the release PR redraws the docs pictures with the lockfile, instead of the docs pinning a version ([0f2a512](https://github.com/felipeadeildo/pi-harness/commit/0f2a512327e853e306d699ba79d71ad446fb9c6a))

## [5.10.0](https://github.com/felipeadeildo/pi-harness/compare/v5.9.2...v5.10.0) (2026-10-14)


### Features

* **ask-questions:** draw previews as written with a scroll bar, write questions live, and label picks, notes and your words ([bb9025b](https://github.com/felipeadeildo/pi-harness/commit/bb9025bde32f3d2970cd4960a22ddbd92903f9d9))
* **compact:** prune when a run ends with Anthropic's clearing off by default, and refuse calls that copy a pruned call ([e255e48](https://github.com/felipeadeildo/pi-harness/commit/e255e48bb871123408e6df99223e231fb9a7c76a))
* **docs:** the brand board at the top of the README, and the settings screen as a scene ([8ae71ca](https://github.com/felipeadeildo/pi-harness/commit/8ae71cad382883fd88f0394c49b59309c7738af9))
* frame pi's own entries, other agents' messages and the judge, drawing with named glyphs from the kit ([e8af129](https://github.com/felipeadeildo/pi-harness/commit/e8af1290fe092378f9fb1df065092b92b4e4401c))
* **kit:** one place merges the betas a request carries, keeping the payload when nothing was added ([384ed71](https://github.com/felipeadeildo/pi-harness/commit/384ed71806e647b357ea2affbb7712581d443b76))
* **kit:** one shape for a token count, a cost and the target of a call, decided once and used by the look ([228dfda](https://github.com/felipeadeildo/pi-harness/commit/228dfdaaecb682cbca82446f98495f6893e36117))
* **kit:** the scroll thumb, the time of day and the prune entry's name live in the kit, so nobody works them out twice ([604793b](https://github.com/felipeadeildo/pi-harness/commit/604793b123f3e1523c6d4a422934d9168d3366c1))
* **look:** a failed CI run and a waiting pull request on the start card ([eab51e4](https://github.com/felipeadeildo/pi-harness/commit/eab51e4f05a81ebd6c3d03c7d37de3e3bb3558c7))
* **look:** a start card with only what changed since your last session in the folder, and a π that rises ([d61a8b1](https://github.com/felipeadeildo/pi-harness/commit/d61a8b17291243b068f063a8730b423110eabc68))
* **look:** Alt+O opens a tool call's whole output to scroll, newest first, with the arrows moving between calls ([8b362bb](https://github.com/felipeadeildo/pi-harness/commit/8b362bbf42055be18dc288a203903d175cfb7857))
* **look:** close a running call's frame until its result draws, waiting for your answer on ask_questions ([8fd4260](https://github.com/felipeadeildo/pi-harness/commit/8fd426087caf1a9224f9e8cf4bc47026ff3fda78))
* **look:** fewer appearance settings with a live preview in Alt+S, and a pencil that inks in its own cell ([174c89c](https://github.com/felipeadeildo/pi-harness/commit/174c89c5701e16f532bd58f51a9816cc1324d3a3))
* **look:** frame your messages like the tool calls, named you, without pi's background and blank rows ([54c3f98](https://github.com/felipeadeildo/pi-harness/commit/54c3f98546c48e3e9e7f65f0741cee8cc60052c9))
* **look:** give ask_questions, peers, memory and the web tools their own marks ([beb4671](https://github.com/felipeadeildo/pi-harness/commit/beb467156356e7e1b6530eec5b79f587b1bb662a))
* **look:** queued messages in a dashed frame and a stretch that runs along a running call's rule ([b2905ee](https://github.com/felipeadeildo/pi-harness/commit/b2905ee3d4e825a70edc33ff1c1f8aff17cccd29))
* **look:** show the end of an edit or a write while the model writes it ([67def04](https://github.com/felipeadeildo/pi-harness/commit/67def04dd4dcd736f50f33f0c56deb1dd2271699))
* **look:** the strip says how the run went once it ends, and every number below the editor has its word ([ab312d5](https://github.com/felipeadeildo/pi-harness/commit/ab312d5ac36e625042967837d692dd6984c7fe34))
* one line for a written ask_questions call, and pi's cut-output note in the frame's words ([475ebab](https://github.com/felipeadeildo/pi-harness/commit/475ebabf2093539d0c721c7ce7e0af1a81ae534f))
* **peers:** [@everyone](https://github.com/everyone) tells every agent and [@anyone](https://github.com/anyone) asks for one, taken requests arrive together and in order ([f55e6a5](https://github.com/felipeadeildo/pi-harness/commit/f55e6a5010f07d68f3eba0aac8e7c16de26ed3ad))
* **peers:** deliver your messages at once and drop /unsend ([b841f16](https://github.com/felipeadeildo/pi-harness/commit/b841f16e78e6a6c2bfd5b6ca19161fd51abfb707))
* **peers:** send to [@name](https://github.com/name) and [@everyone](https://github.com/everyone) from the chat, replacing /to, /all and /room ([4db84f2](https://github.com/felipeadeildo/pi-harness/commit/4db84f21b076fae033b46e9cca7f182e3c6baad1))
* **peers:** the room draws messages and drafts in the transcript's frame ([69bc560](https://github.com/felipeadeildo/pi-harness/commit/69bc5600cebecab1a21f1a13bc2c012423b3b2f4))
* **providers:** keep the prompt cache warm between runs while you are likely to come back ([667ba34](https://github.com/felipeadeildo/pi-harness/commit/667ba3495b5bb40791cdfedd8feffac7c07f02b6))
* **providers:** list this session's cache misses with their cause and cost in the Providers tab ([2ca0b18](https://github.com/felipeadeildo/pi-harness/commit/2ca0b182c370d5e1bd64e866b522abdab9d391df))
* **providers:** pin the Claude Code version and let the settings pick the betas ([ce8549e](https://github.com/felipeadeildo/pi-harness/commit/ce8549e97f1b379904d0174dfe1ba9eb0f95f597))
* **providers:** read the beta notes out of the binary and show the pinned version read only ([f3ddccc](https://github.com/felipeadeildo/pi-harness/commit/f3ddcccd4ad2997e8dfb500885ff19ff38be5ee7))
* **scripts:** a typing bench that says where each keystroke's time goes ([9f6dced](https://github.com/felipeadeildo/pi-harness/commit/9f6dced8d0b3c4d9abcfe9629e26de713c081494))
* **scripts:** reverse engineer Claude Code on a cron and open a bump pull request ([88be6c4](https://github.com/felipeadeildo/pi-harness/commit/88be6c40be32622e8e63a34de7e1f5eee8cc15c2))


### Bug Fixes

* **docs:** draw the brand board from SVG groups, so the check needs no rsvg-convert ([7b59cb9](https://github.com/felipeadeildo/pi-harness/commit/7b59cb99544ce7a9e212512aff97458fbb603fe4))
* draw framed transcript entries once per change instead of on every keystroke ([ca82a60](https://github.com/felipeadeildo/pi-harness/commit/ca82a60fef5b7e89a431c6f56ffa6bd01bd1c239))
* keep the bench out of the room, and never announce a session that does nothing ([8ea3346](https://github.com/felipeadeildo/pi-harness/commit/8ea3346bc2c2e4e3ef0984601499f5961e2e701e))
* **look:** hand the GitHub answer to the header's listen call ([a607545](https://github.com/felipeadeildo/pi-harness/commit/a607545610b4cc36b2bd557598dfc845293b71fe))
* **look:** say the cache figure below the editor is the last prompt's, not the session's ([d24d0fb](https://github.com/felipeadeildo/pi-harness/commit/d24d0fb4e68fa082d3e701fd210ea866911446ad))
* **look:** the runner's output cap is the one git had, and readGit's runner is covered by a test ([9761f95](https://github.com/felipeadeildo/pi-harness/commit/9761f953b3fe5832e2f380c8748dfcc9c6ceb4e8))
* **peers:** a subagent stays out of the room, and a woke note carries its delivery ([4ba6407](https://github.com/felipeadeildo/pi-harness/commit/4ba6407a6c2c733ccd6a8e738ea16dea33143292))
* **peers:** turn the peers tool back on before a run when a reload left it off ([0b69bfc](https://github.com/felipeadeildo/pi-harness/commit/0b69bfc0e6c587fcef7b7908cd852502fed8abc5))
* **providers:** after you stop on an account at its limit, its next limits fail without asking again until it answers ([1babbaa](https://github.com/felipeadeildo/pi-harness/commit/1babbaa4673ad90da0309a39a55f69a146a05b3c))
* **providers:** read the feature gates from identifiers, and the binary only once ([8440136](https://github.com/felipeadeildo/pi-harness/commit/844013671ca7b165d7d8c3432791a5758684a668))
* **providers:** the web search beta says Vertex and Foundry once, and esc on the limit dialog is tested as stopping ([8e1259d](https://github.com/felipeadeildo/pi-harness/commit/8e1259de66af4df7ce158ebd3b36140fd57dd8cb))


### Performance Improvements

* **kit:** the screen keeps the lines it built, one group per section, and measures a frame row before cutting it ([ae0293f](https://github.com/felipeadeildo/pi-harness/commit/ae0293fb25639a1fba8895c049e4c1ee316745a9))
* **look,kit:** measure a line before cutting it, which is what the editor paid per keystroke (37 and 31 ms gone from a 2.2 s typing window) and the frames on every rule ([427d1b0](https://github.com/felipeadeildo/pi-harness/commit/427d1b0edeb265273482918d66aac16a11bf5ce9))
* **look:** keep the footer and the strip drawn for 100 ms, dropped by anything that asks for a redraw (footer 31/25 ms -&gt; 10 ms, busy window 550/584 -&gt; 468/486 ms) ([a37f3fb](https://github.com/felipeadeildo/pi-harness/commit/a37f3fb1a994e75e5ad6bb7f31d2b8f82518a322))
* **look:** resolve the glyph set once per setting change, not on every frame, rule and slot: 153 and 96 ms gone from a 2.2 s typing window (p50 10.2 ms) ([57ce92d](https://github.com/felipeadeildo/pi-harness/commit/57ce92df566997a6201e64427b8ce19d12ff3007))
* **look:** the Alt+O view wraps its lines once, one stat answers whether a write replaces a file, and the filler and the header measure before cutting ([94b8cfe](https://github.com/felipeadeildo/pi-harness/commit/94b8cfea37356153f867c59cc93489bed73199a3))
* **peers:** one pass over the peers per frame, and the group words from one place ([d5191be](https://github.com/felipeadeildo/pi-harness/commit/d5191be83ae866f0b9f93f85c5ce0a6a5f6fdba7))
* **providers:** learn the return chance line by line, and check the cached Claude Code binary without reading it ([f7d1fa8](https://github.com/felipeadeildo/pi-harness/commit/f7d1fa8496ce034133565b10b6623d96a3f7963f))
* redraw the start card, context use and finished entries only when they change; animate the marks of running, waiting and writing calls ([b8e20ba](https://github.com/felipeadeildo/pi-harness/commit/b8e20baa8078f142fcadcd2246c7d3d3600d873a))
* **scripts:** the newest-pi compare reads the registry once, and the release notes only when a body needs them ([7d3d1dd](https://github.com/felipeadeildo/pi-harness/commit/7d3d1dde418bfb7deeabe37120e8f33457c2701e))


### Reverts

* **docs:** drop the brand board, the session card stays as the one picture ([1679bbd](https://github.com/felipeadeildo/pi-harness/commit/1679bbda5f7c66cc560e858feb6e03988c124792))

## [5.9.2](https://github.com/felipeadeildo/pi-harness/compare/v5.9.1...v5.9.2) (2026-10-13)


### Bug Fixes

* **ask-questions:** draw pi's error when the tool throws instead of crashing ([7f9a8a3](https://github.com/felipeadeildo/pi-harness/commit/7f9a8a374fa506a077bcdc9051ec30c7f0316ebc))

## [5.9.1](https://github.com/felipeadeildo/pi-harness/compare/v5.9.0...v5.9.1) (2026-10-13)


### Bug Fixes

* **providers:** list every other account when one hits its limit ([e1e84a2](https://github.com/felipeadeildo/pi-harness/commit/e1e84a2d9163f20ca101931203456e9b233e3644))

## [5.9.0](https://github.com/felipeadeildo/pi-harness/compare/v5.8.0...v5.9.0) (2026-10-13)


### Features

* **kit:** log events per session ([fc09298](https://github.com/felipeadeildo/pi-harness/commit/fc092987dde5fdb571e82237f4d4e50ea01defad))
* **kit:** one frame for every dialog, with no backgrounds and the keys in its edge ([e5115ec](https://github.com/felipeadeildo/pi-harness/commit/e5115ec79637967e1726d5d7bab69f586c7e8db3))
* **kit:** stamp events with a given time ([bd7b6e3](https://github.com/felipeadeildo/pi-harness/commit/bd7b6e3d010a8324822bb8c90f7bf11dea29d132))
* **peers:** agents in one folder that talk and split work ([39f3802](https://github.com/felipeadeildo/pi-harness/commit/39f38029b7f34dff5f379b8cad8f7f3c281e847d))
* **peers:** show who is writing over the editor, and requests other agents took in the chat ([d9fae31](https://github.com/felipeadeildo/pi-harness/commit/d9fae31496b4456030bf4c9c800af13973512e18))
* **peers:** the Alt+G room and the footer marks ([a597e1b](https://github.com/felipeadeildo/pi-harness/commit/a597e1bbc4a2702c72daad9f697cfe676c97d182))
* **peers:** write in the room's own column, scroll it with the arrows, and label what each agent does ([96169b8](https://github.com/felipeadeildo/pi-harness/commit/96169b84ca040afa7d6bba5088bca5ea6b4185d2))
* **tasks:** give sessions a short name and log changes ([cda208b](https://github.com/felipeadeildo/pi-harness/commit/cda208bd06ae5fdf2005ece4083f8343c4cf1bba))


### Bug Fixes

* **kit:** drop whole keys from a narrow frame, keeping the way out ([6baddfe](https://github.com/felipeadeildo/pi-harness/commit/6baddfe21acc8c5330f6ed5d28389938c3ed482d))
* **peers:** always say how a user message queues ([a424736](https://github.com/felipeadeildo/pi-harness/commit/a424736bb48ff63cdb40d901d020aec01908d2cd))
* **peers:** attach a burst between calls, and let the setting decide how ([0b735fa](https://github.com/felipeadeildo/pi-harness/commit/0b735fa0b292d633946d70726bfbfbe6de1ab0c8))
* **peers:** draw each column to its own width ([de1554f](https://github.com/felipeadeildo/pi-harness/commit/de1554f782bbe0ac5bb201e9538b87d580d82134))
* **peers:** draw the room's clock in every timezone ([e95bc46](https://github.com/felipeadeildo/pi-harness/commit/e95bc4641d6ec78a4a2bf7b0ffa5150b9290bc53))
* **peers:** drop the rails and repeated quotes from the room, keeping a rail only on what just arrived ([5f54cee](https://github.com/felipeadeildo/pi-harness/commit/5f54cee0529ce09d33f4f3961a65be34ebaffc89))
* **peers:** let a read of the folder through, and keep peers off the footer's own colours ([f69e73b](https://github.com/felipeadeildo/pi-harness/commit/f69e73b6c15514de279e52e08c6331eceb748f94))
* **peers:** show only state, current task and edited files for each agent, wrapping the task ([bc6e22f](https://github.com/felipeadeildo/pi-harness/commit/bc6e22f2a8208781fe8b24c8667b6e28e24fa1b6))
* **peers:** wake an idle agent for any message, and stop only a chain of agents answering each other ([40b546c](https://github.com/felipeadeildo/pi-harness/commit/40b546c0c478926a9eb9f71d47776f15586556bc))

## [5.8.0](https://github.com/felipeadeildo/pi-harness/compare/v5.7.2...v5.8.0) (2026-10-12)


### Features

* **ask-questions:** show each answer under its question ([91a25d9](https://github.com/felipeadeildo/pi-harness/commit/91a25d994ff2ef3034e8cfa03ee4a39ac01d1370))
* **compact:** clear on Anthropic's side, keeping thinking ([84b9fde](https://github.com/felipeadeildo/pi-harness/commit/84b9fdef56e8ec6d08b79ecae46622a68c9669c2))
* **tasks:** keep the session title short and in English ([46dba76](https://github.com/felipeadeildo/pi-harness/commit/46dba762ef4b7a6984e09e017efac3f6bfcf0396))
* **tasks:** name the session after its title ([6d5b528](https://github.com/felipeadeildo/pi-harness/commit/6d5b5282f1cb19c2815162794b9d223d6aee9c90))


### Bug Fixes

* **ask-questions:** scroll previews in fullscreen pi ([ec52e52](https://github.com/felipeadeildo/pi-harness/commit/ec52e52110729cfafaacb571fa1b497c4c0ca7aa))
* **compact:** see the first clear after a reload ([c88c2a5](https://github.com/felipeadeildo/pi-harness/commit/c88c2a5b7f997df0462a2ffb4c9ad7904aa2b074))
* **tasks:** name a session titled before it opened ([b43f946](https://github.com/felipeadeildo/pi-harness/commit/b43f9466b45ef2e57cc2318f9bb6269528588a1c))
* **ui:** cut text with ... instead of an ellipsis ([a7c474b](https://github.com/felipeadeildo/pi-harness/commit/a7c474bee5e28cb59be3acbffe6f07997ad8d922))

## [5.7.2](https://github.com/felipeadeildo/pi-harness/compare/v5.7.1...v5.7.2) (2026-10-12)


### Bug Fixes

* **compact:** price the whole cache rewrite ([c9493c4](https://github.com/felipeadeildo/pi-harness/commit/c9493c468bb88dc6a08b9b9d6ffd39df94b1111a))

## [5.7.1](https://github.com/felipeadeildo/pi-harness/compare/v5.7.0...v5.7.1) (2026-10-12)


### Bug Fixes

* **compact:** let pi write the summary on the side model ([b290de0](https://github.com/felipeadeildo/pi-harness/commit/b290de0da6716b40a3d5a4650dcd11e48ae2442f))

## [5.7.0](https://github.com/felipeadeildo/pi-harness/compare/v5.6.0...v5.7.0) (2026-10-12)


### Features

* **compact:** hide old tool output in long sessions ([002079e](https://github.com/felipeadeildo/pi-harness/commit/002079efc3788de5c4066a808d80d54368933d39))
* **tasks:** change tasks with keys on Alt+T ([3a197d3](https://github.com/felipeadeildo/pi-harness/commit/3a197d3634db91728227968225b5280edd0b9182))


### Bug Fixes

* **compact:** align the prune line and show its cost ([ce401de](https://github.com/felipeadeildo/pi-harness/commit/ce401de5e6f71ca9c81343169372f69a3329a3eb))
* **tasks:** close what waited on you when you say you did what the agent just asked, and keep every field in your language ([29d7e46](https://github.com/felipeadeildo/pi-harness/commit/29d7e463fc52b5f0b74e0ef48345fb36300ca4f7))


### Dependencies

* bump the pi SDK to 1.1.0 ([25752cd](https://github.com/felipeadeildo/pi-harness/commit/25752cd13c6790ff9880f6a804e1212280151a53))

## [5.6.0](https://github.com/felipeadeildo/pi-harness/compare/v5.5.0...v5.6.0) (2026-10-12)


### Features

* **goal:** check every close against the session's words and measure the timeline against real cases ([4e89852](https://github.com/felipeadeildo/pi-harness/commit/4e89852d2b0ce46d604a13bbc4972ebe789eee34))
* **goal:** move a cursor through the Alt+G timeline on a solid panel, with the note of the item under it ([4cbf29c](https://github.com/felipeadeildo/pi-harness/commit/4cbf29cda702b65be33fb33a980e4053f2420ec0))
* **goal:** open the session's timeline as a tree on Alt+G, and keep the goal's counts beside a busy strip ([c6a2519](https://github.com/felipeadeildo/pi-harness/commit/c6a251997d031201b0b8058c23e602a1c4c50e88))
* **kit:** keep a session's tasks, with results, waits, decisions and the goal timeline read as tasks ([564f581](https://github.com/felipeadeildo/pi-harness/commit/564f58183c654d6349a6787309b5b377118defd2))
* **tasks:** replace the goal with tasks that keep what was done, what waits on you and what was decided ([fd52c94](https://github.com/felipeadeildo/pi-harness/commit/fd52c944457a151586fe12b24aec329d6ea1dc6c))


### Bug Fixes

* **goal:** close a step only when its run ends, never over a failed call or words that do not name it ([c32ba71](https://github.com/felipeadeildo/pi-harness/commit/c32ba71902dfe85d1f375141b617e110e201458a))
* **goal:** close nothing on a call alone, and mark the calls that failed or were refused ([206b29d](https://github.com/felipeadeildo/pi-harness/commit/206b29d7473e4a62413db48fe36bbaf277e6e78d))
* **goal:** close what repeats done work, read more of the conversation when tidying, and round the Alt+G panel's corners ([1566bf6](https://github.com/felipeadeildo/pi-harness/commit/1566bf690caf0e0778d0433d3f6e2715f4bd17e2))
* **goal:** give up a call that does not come back, so one stuck request cannot stop the timeline ([561e6ea](https://github.com/felipeadeildo/pi-harness/commit/561e6ea43ca0aede69e90c091849f4b6fa0d153e))
* **goal:** keep agent-rewritten words out of the intent, keep the counts on a short line, and wait for the goal through a plain event ([52c83b9](https://github.com/felipeadeildo/pi-harness/commit/52c83b974ce442c789d2d5659b0b81cbde91826c))
* **goal:** keep the Alt+G panel still, with one line per item and the selected one in full in a fixed pane ([4c0b191](https://github.com/felipeadeildo/pi-harness/commit/4c0b191ee7df6e94556e3eb456f92cb2d4a892ca))
* **goal:** keep what a finished step left in its note, not as a new item for later ([a56535d](https://github.com/felipeadeildo/pi-harness/commit/a56535d1e41ba022bd81d97a0b74fb1f9e24535b))
* **goal:** open one step per message, never close on words older than the item, and let you undo a done step that did not happen ([632cbcc](https://github.com/felipeadeildo/pi-harness/commit/632cbcc1c85a4d011722decc6db5b854ae11bd1b))
* **goal:** read your message when it enters the conversation, keep the goal on the current topic, and clear the lint warnings ([5609dae](https://github.com/felipeadeildo/pi-harness/commit/5609dae282835b7493c1a0d8162f760441f21f6a))
* **goal:** start a step at the message that asked for it, and read a named skill as the ask it is ([c6e993e](https://github.com/felipeadeildo/pi-harness/commit/c6e993e519c35a63eeb7afa9e11dc2fdc5acd308))
* **providers:** let requests that hit a limit together share one dialog, and open dialogs one at a time ([5f81cc1](https://github.com/felipeadeildo/pi-harness/commit/5f81cc1a8bd144366cc50a3881f3096a49398cda))
* **tasks:** open tasks only from your words, back every wait and decision with its line, and keep the end of a long message ([040496d](https://github.com/felipeadeildo/pi-harness/commit/040496d2c493f94d8ae97d5d4b068c91be1da82c))
* **tasks:** read your answers in the questions dialog as your words, in the same lines the agent reads ([26d7a2b](https://github.com/felipeadeildo/pi-harness/commit/26d7a2bbc64668b8cae2b10cb6d6b1492373de48))

## [5.5.0](https://github.com/felipeadeildo/pi-harness/compare/v5.4.0...v5.5.0) (2026-10-06)


### Features

* **goal:** keep the session's timeline (now, done, later) and give the judge your intent ([cef1fe1](https://github.com/felipeadeildo/pi-harness/commit/cef1fe1a16abf3e1f8228f52c0939d5ce738e355))
* **goal:** tidy from your words and the agent's work, and count what every goal call costs ([e12eec5](https://github.com/felipeadeildo/pi-harness/commit/e12eec5c1177b4b85a8f6c1e46642d40755ed48c))
* **goal:** title the timeline with the session's goal, and count what waits instead of showing its first line ([4daf43f](https://github.com/felipeadeildo/pi-harness/commit/4daf43f2b5411b665663f7f37485b22b89971ed7))


### Bug Fixes

* **ask-permission:** say on the ruling when the judge saw the session's goal ([4e79dcc](https://github.com/felipeadeildo/pi-harness/commit/4e79dccfff7e4467bacc8f810a7a562fabc8e4c9))

## [5.4.0](https://github.com/felipeadeildo/pi-harness/compare/v5.3.0...v5.4.0) (2026-10-06)


### Features

* **skills:** call several skills anywhere in a message, drawn as chips in the chat ([ff47dfe](https://github.com/felipeadeildo/pi-harness/commit/ff47dfe9af64c1771bd6c50b058d5ceb3745f7a5))

## [5.3.0](https://github.com/felipeadeildo/pi-harness/compare/v5.2.0...v5.3.0) (2026-10-06)


### Features

* **ask-questions:** wait until you stop typing before the model's questions open ([fbfdb10](https://github.com/felipeadeildo/pi-harness/commit/fbfdb1033e853e7c288a8101c9e35e4e2320af9f))
* **look:** carry the account next to the model and the plan's windows in the footer ([3e7d326](https://github.com/felipeadeildo/pi-harness/commit/3e7d326da6784e984170156b25a733ac0f07f6b5))
* **look:** frame the calls of tools that bring no renderers of their own ([dccb08b](https://github.com/felipeadeildo/pi-harness/commit/dccb08b201b9c9ea5669c3f81cbc35fa3c989e7f))
* **look:** say in the frame when the account needs a sign-in ([06eaa58](https://github.com/felipeadeildo/pi-harness/commit/06eaa5833ddc62db9747910d7b30b6cb5ee9cbd9))
* **providers:** keep each account's health and adopt the logins that arrive ([b3a1834](https://github.com/felipeadeildo/pi-harness/commit/b3a1834e7ac8e3eeaf6cd36afe8b6c285a9ae6f0))
* **providers:** keep the plan's quota from each response and count down its reset ([e318f79](https://github.com/felipeadeildo/pi-harness/commit/e318f79e94484a83cbbece737f0ef41c64597618))
* **providers:** move to another account when one is refused, and frame the dialogs ([f231bf2](https://github.com/felipeadeildo/pi-harness/commit/f231bf2441a5e237bc3b44d46dc60a4a44107989))
* **providers:** name every credential of a provider with accounts, and manage them in /accounts ([568944b](https://github.com/felipeadeildo/pi-harness/commit/568944b7cc04d3b36a63d6525c02740047637682))
* **providers:** read each account's plan and show it in the picker ([13d26d0](https://github.com/felipeadeildo/pi-harness/commit/13d26d0f3bec19a90fc2cd7d9358bc7107382978))
* **providers:** read the plan's quota from the endpoint and show it in the picker ([e99fdc7](https://github.com/felipeadeildo/pi-harness/commit/e99fdc755d94d11d9b0568d352eea826301fbbe8))
* **providers:** run a provider login on our own framed screen ([6cdde83](https://github.com/felipeadeildo/pi-harness/commit/6cdde83436adb92b26341f260c8c6a142c3a32b6))


### Bug Fixes

* **ask-permission:** ask about a codemode script's calls one at a time ([6f18955](https://github.com/felipeadeildo/pi-harness/commit/6f18955a0f7d289d145c1ba157ad95f748bfe3ad))
* **look:** keep a replayed call open for its result to close ([626eefe](https://github.com/felipeadeildo/pi-harness/commit/626eefeb95a5b24cb6d1fd842e87b0cbb28a12cb))
* **look:** leave the cost and the tokens out until the session spends some ([b023cb5](https://github.com/felipeadeildo/pi-harness/commit/b023cb5aa63a7fd016ba973e2f7e5ff1d3053561))
* **providers:** close the lock's own descriptor, not writeSync's count ([77f692b](https://github.com/felipeadeildo/pi-harness/commit/77f692bfae7d7b4b53af1ffd8a97037678fbabca))
* **providers:** read the plans of the provider a model switch lands on ([2476f16](https://github.com/felipeadeildo/pi-harness/commit/2476f1639e4ba7b3d75d85b8776c042da1902b05))
* **providers:** refresh an account under a lock two pi processes share ([c643481](https://github.com/felipeadeildo/pi-harness/commit/c64348178d2bbab4f484137db937424a4d95be5e))
* **providers:** refresh an expired account before reading its plan ([90316b9](https://github.com/felipeadeildo/pi-harness/commit/90316b9175d348e157641636872b3a708e700103))
* **providers:** show the sign-in URL itself and open the browser, like pi does ([ce2ea18](https://github.com/felipeadeildo/pi-harness/commit/ce2ea188efa2016f80987aab4dd4444a58a6f1c3))
* **providers:** stop /accounts from adopting the credential it adds ([6323d41](https://github.com/felipeadeildo/pi-harness/commit/6323d41f3380451a05b6cc696dc8ba32ff101ea6))

## [5.2.0](https://github.com/felipeadeildo/pi-harness/compare/v5.1.0...v5.2.0) (2026-10-03)


### Features

* **ask-permission:** answer yes instead of yes, run it ([093104f](https://github.com/felipeadeildo/pi-harness/commit/093104f727f52044606ec9a21967ca94d3cd421e))
* **ask-permission:** keep your answer on one line, and say when a call was blocked ([f08d370](https://github.com/felipeadeildo/pi-harness/commit/f08d3703d572d1ec5721b9eb12ef6b97d806f247))
* **ask-permission:** list every classifier pi knows in the judge model picker ([1745950](https://github.com/felipeadeildo/pi-harness/commit/17459507445e75cad2b91c6805499db1156be125))
* **ask-permission:** say on each call who decided and why, and judge parallel calls together ([fb9d716](https://github.com/felipeadeildo/pi-harness/commit/fb9d716c1e27805b6ceba1dfe53bdb6e6f5e3d58))
* **kit:** light the section under the cursor and keep it in view ([eb265c2](https://github.com/felipeadeildo/pi-harness/commit/eb265c22e97b3781082c03ca26b22e663817a331))
* **look:** count the pictures pi draws below a call, and drop the name from the license line ([cb8d086](https://github.com/felipeadeildo/pi-harness/commit/cb8d086986304246d76084c44a9ada9eb75b8d4d))
* **look:** frame every tool call, with the permission ruling on it ([ba330d0](https://github.com/felipeadeildo/pi-harness/commit/ba330d0ffa01700d338fa60ce4801a22112112ed))
* **look:** keep the time of a call on its frame, running or done ([d3e71dc](https://github.com/felipeadeildo/pi-harness/commit/d3e71dc9d17b14bea1c056a8ee19717e4b310e26))
* **look:** say what a tool call is, what it printed, and how it went ([9a569e6](https://github.com/felipeadeildo/pi-harness/commit/9a569e6550c2fcc65bfd113b59384408462060aa))
* **look:** say when a call is being written, waiting or running, and keep both times ([c7de912](https://github.com/felipeadeildo/pi-harness/commit/c7de9127067ecf3e97079be6084e2aca51698d1d))


### Bug Fixes

* **ask-permission:** drop the verdicts in flight when a branch opens ([dc87013](https://github.com/felipeadeildo/pi-harness/commit/dc87013698bcbbac233caad0519e79eef7a7be9a))
* **docs:** pin the colour depth so CI draws the same pictures ([2a685b5](https://github.com/felipeadeildo/pi-harness/commit/2a685b5463b8aa204eb47fc7f636cd0fc47f07e7))
* **kit:** line up a choice's descriptions and keep long labels whole ([cf8da04](https://github.com/felipeadeildo/pi-harness/commit/cf8da04236ebf8a0bd70d8185790e2c0390d2db7))
* **look:** draw a tool call again only when it changed, and guard the redraw with a test ([040e22f](https://github.com/felipeadeildo/pi-harness/commit/040e22f8fe074d9dc476ff42b9088af7e8377cd8))

## [5.1.0](https://github.com/felipeadeildo/pi-harness/compare/v5.0.0...v5.1.0) (2026-10-02)


### Features

* **ask-permission:** bring the questions dialog with the package and drop the classic one ([8546f71](https://github.com/felipeadeildo/pi-harness/commit/8546f71dc06fdc32e4ddc052ee012c27db727bdb))
* **ask-questions:** redesign the dialog with a fixed-size detail panel, inline notes and tabs that show what is answered ([8e83b4b](https://github.com/felipeadeildo/pi-harness/commit/8e83b4b0ffb1870cb46739e8ec3eba442c067b38))
* **ask-questions:** write notes in the panel, fill the width, and let a question leave out the typed row ([0569f67](https://github.com/felipeadeildo/pi-harness/commit/0569f67febc328af03f1a4113744ff5d3d7d4771))


### Bug Fixes

* **ask-permission:** put the command right under what wants to run ([e226554](https://github.com/felipeadeildo/pi-harness/commit/e2265541b825ae826c5a3dbb0dfeada6e98ac05c))
* **ask-permission:** show the first 3 lines of a long command and how many are left ([3bd672c](https://github.com/felipeadeildo/pi-harness/commit/3bd672c7a5a6a7cc6b5006270405759790bfeb57))
* **ask-questions:** show a note once, in the panel, and mark its option with an arrow ([69b51a7](https://github.com/felipeadeildo/pi-harness/commit/69b51a71345cd1d55a0eeb98795f06e6d248ef0c))
* **ask-questions:** size the panel for notes, name the row only when its label is cut, and drop the spare blank lines ([9f71fa0](https://github.com/felipeadeildo/pi-harness/commit/9f71fa0b3c7e860c7d09620ac7b8bd83346ca034))

## [5.0.0](https://github.com/felipeadeildo/pi-harness/compare/v4.1.0...v5.0.0) (2026-10-01)

Every piece lives on one settings screen now, and a new package joins the set: the model asks with options instead of guessing.

This release needs **pi 0.99.2**, which is what MCP and the tool annotations come from.

### ⚠ BREAKING CHANGES

* **ask-permission:** the judge is set with a model, a policy and a rigor, and it reads your last message as the intent behind the call. `judge.provider`, `judge.enabled` and `judge.tools` are gone, and the retired keys are removed from the settings file on the next session, with a notice ([87014f3](https://github.com/felipeadeildo/pi-harness/commit/87014f3623604d8ed496b8e0a0645b05a1ed188f))
* **every piece:** one settings screen on `Alt+S`, a tab per piece, in place of `/perm` and `/look` ([9cc50c0](https://github.com/felipeadeildo/pi-harness/commit/9cc50c05650c900265d08d00e151f9053c21b34a))
* **ask-permission:** four modes, manual, edits, judge and full, with `Alt+W` for calls outside the workspace ([3f0348a](https://github.com/felipeadeildo/pi-harness/commit/3f0348ab164f758ff470758dfc69b30daf0dc753))

### Features

* **ask-questions:** a new package, `@adeildo/pi-ask-questions`, with the `ask_questions` tool. Every question comes with options, a preview of the option under the cursor, a note on any option whether it was picked or not, and a row for your own answer. The dialog is drawn in the flow of the screen instead of over the chat, so a tall one scrolls with the terminal ([95fc137](https://github.com/felipeadeildo/pi-harness/commit/95fc137404b348bb8f1c1774a4e7dda75f70c980))
* **ask-permission, ask-questions:** one dialog for both. The permission ask goes through the questions package, with the call, the reason and the diff riding in the question. `always yes` then asks which calls to remember and for how long, and an answer typed in your own words blocks the call, with the text as the reason the model reads ([0ebcec2](https://github.com/felipeadeildo/pi-harness/commit/0ebcec283b409f7771505098803003d6353150c2))
* **ask-permission:** a call to an MCP server follows the policy of its server, set on the Permission tab, and a call a codemode script made is decided on its own, instead of asking twice for one thing ([08e3810](https://github.com/felipeadeildo/pi-harness/commit/08e38104297e274e05fa355155c532904d07af4b))
* **ask-permission:** a call that leaves the workspace offers to open that folder, for reads or as part of the workspace ([09cc796](https://github.com/felipeadeildo/pi-harness/commit/09cc79648768d888e1230d35f0fd5cca9e05dcd0))
* **providers:** several accounts per provider. The pi login becomes the first account, another comes from the provider's own login, the active one is a session entry so a resume restores who paid, and `Alt+A` cycles them ([09049cf](https://github.com/felipeadeildo/pi-harness/commit/09049cfbe32c656c468c926ffc770360b684308d), [2e8ef4b](https://github.com/felipeadeildo/pi-harness/commit/2e8ef4b0497896ed6228cd48515f5523bad4f29e))
* **providers:** an account that hits its limit hands over to the next one, asking first by default ([5adbfb0](https://github.com/felipeadeildo/pi-harness/commit/5adbfb0a020d37d5a8a2b4c33509fb2f50a6f897))
* **look:** the account sits next to the model, and the working line names the state in lower case instead of repeating the call being drafted ([4ef6328](https://github.com/felipeadeildo/pi-harness/commit/4ef632884a9c47681dfb30d4af9813909d5dc138), [f689c2d](https://github.com/felipeadeildo/pi-harness/commit/f689c2d87be7701dd92aa8b379c6b98b8d23f6f8))
* **look:** the wait is timed from the moment the request leaves the machine, and the token speed uses the ratio the session measured, in place of a flat four characters per token ([29e74b4](https://github.com/felipeadeildo/pi-harness/commit/29e74b471cd9ee6dd72a62ac99ec163f7ba96957))
* **every piece:** the middle dots are gone from the dialogs, the hints and the status lines, and the footer separator defaults to a space ([a3814b4](https://github.com/felipeadeildo/pi-harness/commit/a3814b4cbd177579a46fbb548c8274ff59ce3096))

### Dependencies

* the pi SDK is bumped to 0.99.2, which this release needs ([b600128](https://github.com/felipeadeildo/pi-harness/commit/b600128))

### Bug Fixes

* **ask-permission:** read a bash command that sets a shell variable before it reads it, and then trust that variable only where bash surely set it and nothing else can change it afterwards ([cd7da40](https://github.com/felipeadeildo/pi-harness/commit/cd7da405f5da4dfcbbc053013148b5a3c262a09a), [0387aa9](https://github.com/felipeadeildo/pi-harness/commit/0387aa9eab80cefc9dc5ceadd290aebbb7fbfe7c))
* **ask-permission:** show what an MCP server declares in the dialog, and keep the registered tool name in `alwaysAsk` ([b4cec5f](https://github.com/felipeadeildo/pi-harness/commit/b4cec5f53a65f11095293c9f6349400d15d9d5fb))
* **providers:** keep a refreshed token on the account it came from, lift a provider when its first account arrives rather than only at session start, and stop caching the native methods ([1e04718](https://github.com/felipeadeildo/pi-harness/commit/1e0471869ae515222fbc27ec557d998a8d43e5ca), [1068ef4](https://github.com/felipeadeildo/pi-harness/commit/1068ef48378a21fd2693afd2a1345e42a9dac17c), [4254a3d](https://github.com/felipeadeildo/pi-harness/commit/4254a3d6d677c541c5351b2600ceafeab9925a54))
* **kit:** a feature that reads or writes a setting it never declared now throws, instead of reading a default forever ([e8a9bc8](https://github.com/felipeadeildo/pi-harness/commit/e8a9bc81ccabd26c97ab0c00199926259668f766))

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
