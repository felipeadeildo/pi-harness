// One read from the daemon, after the login, and what a screen draws while it runs or when it fails.
import { type ReactNode, useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { browserSource } from "@/session/browser.ts";
import { whyOf } from "@/session/why.ts";

export type Read<T> =
	| { value: T; why?: undefined }
	| { value?: undefined; why: string }
	| undefined;

/** One read after the login, again when `again` is called; a later read keeps the last value. */
export function useRead<T>(read: () => Promise<T>, what: string): [Read<T>, () => void] {
	const [state, setState] = useState<Read<T>>(undefined);
	const [round, setRound] = useState(0);
	useEffect(() => {
		let open = true;
		void browserSource()
			.then((ready) => {
				if (ready.why !== undefined) throw new Error(ready.why);
				return read();
			})
			.then(
				(value) => open && setState({ value }),
				(error: unknown) => open && setState({ why: whyOf(error, what) }),
			);
		return () => {
			open = false;
		};
	}, [read, what, round]);
	return [state, useCallback(() => setRound((one) => one + 1), [])];
}

/** What a read draws while it runs and when it fails; `children` draws what it read. */
export function Loaded<T>({
	state,
	again,
	reading,
	children,
}: {
	state: Read<T>;
	again: () => void;
	reading: string;
	children: (value: T) => ReactNode;
}): ReactNode {
	if (state === undefined) return <Quiet>{reading}</Quiet>;
	if (state.why !== undefined) return <Failed why={state.why} again={again} />;
	return children(state.value);
}

export function Quiet({ children }: { children: ReactNode }): ReactNode {
	return <p className="px-1 py-2 text-[13px] text-muted-foreground">{children}</p>;
}

function Failed({ why, again }: { why: string; again: () => void }): ReactNode {
	return (
		<div className="flex items-center gap-3 px-1 py-2">
			<p className="min-w-0 flex-1 text-[13px] text-destructive">{why}</p>
			<Button variant="outline" size="sm" onClick={again}>
				Try again
			</Button>
		</div>
	);
}
