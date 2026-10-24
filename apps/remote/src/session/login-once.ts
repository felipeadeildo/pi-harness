// The link the daemon prints points at the app's root, not at a session, so the login happens once
// when the page opens: the token is spent there, and any route that needs the daemon finds the cookie
// already in place. It runs in an effect, because the static export renders these routes on a server.
import { useEffect } from "react";

import { browserSource } from "./browser.ts";

export function useLoginOnce(): void {
	useEffect(() => {
		void browserSource();
	}, []);
}
