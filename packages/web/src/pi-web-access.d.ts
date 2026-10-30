declare module "pi-web-access/dist/index.js" {
	import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

	export default function webAccess(pi: ExtensionAPI): void;
}
