// The frame: on a wide screen the list stays at the left beside the open session; on a phone the
// list is the home screen and a session takes the whole screen.
import { ComputerTerminal01Icon } from "@hugeicons/core-free-icons";
import { cn } from "cn";
import type { ReactNode } from "react";
import { Link, Outlet, useParams } from "react-router";

import { TooltipProvider } from "@/components/ui/tooltip";

import { Icon } from "./kit.tsx";
import { SessionList } from "./list.tsx";

export function Shell(): ReactNode {
	const { machine, id } = useParams();
	const open = machine !== undefined && id !== undefined;
	return (
		<TooltipProvider>
			<div className="flex h-dvh min-h-0 overflow-hidden">
				<nav
					aria-label="Sessions"
					className={cn(
						"h-full min-h-0 w-full shrink-0 flex-col overflow-y-auto border-r lg:flex lg:w-[22rem]",
						open ? "hidden" : "flex",
					)}
				>
					<header className="sticky top-0 z-10 flex items-center gap-2 bg-background/95 px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-3">
						<Link
							to="/"
							className="flex items-baseline gap-1.5 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
						>
							<span className="wide text-[22px] leading-none font-bold text-pi">π</span>
							<span className="wide text-[17px] font-semibold">remote</span>
						</Link>
					</header>
					<div className="px-3 pb-6">
						<h1 className="sr-only">Sessions</h1>
						<SessionList {...(open ? { current: `${machine}/${id}` } : {})} />
					</div>
				</nav>
				<div className={cn("h-full min-h-0 min-w-0 flex-1", open ? "flex" : "hidden lg:flex")}>
					<Outlet />
				</div>
			</div>
		</TooltipProvider>
	);
}

export function Pick(): ReactNode {
	return (
		<main className="flex h-full flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
			<Icon icon={ComputerTerminal01Icon} className="size-7 text-dim" />
			<p className="text-sm text-muted-foreground">Pick a session on the left to follow it here.</p>
		</main>
	);
}
