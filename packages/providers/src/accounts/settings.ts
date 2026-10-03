import { literal, setting } from "@adeildo/pi-kit";

/** What a policy does when the provider will not serve an account. */
export const WHEN_LIMITED = ["ask", "switch", "stop"] as const;
export type WhenLimited = (typeof WHEN_LIMITED)[number];

function policy(id: string, label: string, description: string) {
	return setting<WhenLimited>({
		id,
		default: "ask",
		decoder: literal(...WHEN_LIMITED),
		ui: {
			section: "Accounts",
			label,
			description,
			control: {
				type: "choice",
				options: [
					{ value: "ask", label: "ask me first" },
					{ value: "switch", label: "switch on its own" },
					{ value: "stop", label: "stop and tell me" },
				],
			},
		},
	});
}

export const onLimit = policy(
	"accounts.onLimit",
	"When an account hits its limit",
	"Ask me first, switch on its own, or stop and tell me.",
);

export const onAuthFailure = policy(
	"accounts.onAuthFailure",
	"When a login is refused",
	"Ask me first, switch to another account, or stop and tell me.",
);
