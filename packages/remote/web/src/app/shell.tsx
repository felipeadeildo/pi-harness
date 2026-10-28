// The frame: the page's sections in a bottom bar on a phone and a rail at the left on a wide screen.
// Inside Sessions, a wide screen keeps the list beside the open session; on a phone the list is the
// section's screen and a session takes the whole screen, bar included.
import { BubbleChatIcon, ComputerIcon, ComputerTerminal01Icon } from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import { cn } from "cn";
import type { ReactNode } from "react";
import { Link, Outlet, useLocation, useParams } from "react-router";

import { TooltipProvider } from "@/components/ui/tooltip";

import { Icon } from "./kit.tsx";
import { SessionList } from "./list.tsx";

interface Section {
	to: string;
	label: string;
	icon: IconSvgElement;
	/** A session's own page belongs to Sessions. */
	owns: (path: string) => boolean;
}

const SECTIONS: readonly Section[] = [
	{
		to: "/",
		label: "Sessions",
		icon: BubbleChatIcon,
		owns: (path) => path === "/" || path.startsWith("/session/"),
	},
	{
		to: "/machines",
		label: "Machines",
		icon: ComputerIcon,
		owns: (path) => path.startsWith("/machines"),
	},
];

export function Shell(): ReactNode {
	const { machine, id } = useParams();
	const inSession = machine !== undefined && id !== undefined;
	return (
		<TooltipProvider>
			<div className="flex h-dvh min-h-0 flex-col overflow-hidden lg:flex-row">
				<Rail />
				<div className="flex min-h-0 min-w-0 flex-1">
					<Outlet />
				</div>
				{inSession ? null : <BottomBar />}
			</div>
		</TooltipProvider>
	);
}

function Rail(): ReactNode {
	const { pathname } = useLocation();
	return (
		<nav
			aria-label="Sections"
			className="hidden w-[4.5rem] shrink-0 flex-col items-center gap-1 border-r pt-4 lg:flex"
		>
			<Link
				to="/"
				aria-label="π remote"
				className="mb-3 rounded-md px-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
			>
				<img src="/mark.svg" alt="" width={28} height={18} className="block" />
			</Link>
			{SECTIONS.map((section) => (
				<SectionLink
					key={section.to}
					section={section}
					active={section.owns(pathname)}
					className="w-14 flex-col gap-1 py-2 text-[11px]"
				/>
			))}
		</nav>
	);
}

function BottomBar(): ReactNode {
	const { pathname } = useLocation();
	return (
		<nav
			aria-label="Sections"
			className="flex shrink-0 border-t bg-background pb-[env(safe-area-inset-bottom)] lg:hidden"
		>
			{SECTIONS.map((section) => (
				<SectionLink
					key={section.to}
					section={section}
					active={section.owns(pathname)}
					className="h-14 flex-1 flex-col gap-0.5 text-[11px]"
				/>
			))}
		</nav>
	);
}

function SectionLink({
	section,
	active,
	className,
}: {
	section: Section;
	active: boolean;
	className: string;
}): ReactNode {
	return (
		<Link
			to={section.to}
			aria-current={active ? "page" : undefined}
			className={cn(
				"flex items-center justify-center rounded-xl outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
				active ? "font-semibold text-foreground" : "text-dim hover:text-muted-foreground",
				className,
			)}
		>
			<Icon icon={section.icon} className={cn("size-5", active && "text-pi")} />
			{section.label}
		</Link>
	);
}

/** The section's title; on a phone, where there is no rail, it carries the π. */
export function SectionHeader({ title }: { title: string }): ReactNode {
	return (
		<header className="sticky top-0 z-10 flex items-center gap-2.5 bg-background/95 px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-3">
			<Link
				to="/"
				aria-label="π remote"
				className="rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50 lg:hidden"
			>
				<img src="/mark.svg" alt="" width={24} height={15} className="block" />
			</Link>
			<h1 className="wide text-[17px] font-semibold">{title}</h1>
		</header>
	);
}

export function Sessions(): ReactNode {
	const { machine, id } = useParams();
	const open = machine !== undefined && id !== undefined;
	return (
		<>
			<nav
				aria-label="Sessions"
				className={cn(
					"h-full min-h-0 w-full shrink-0 flex-col overflow-y-auto border-r lg:flex lg:w-[22rem]",
					open ? "hidden" : "flex",
				)}
			>
				<SectionHeader title="Sessions" />
				<div className="px-3 pb-6">
					<SessionList {...(open ? { current: `${machine}/${id}` } : {})} />
				</div>
			</nav>
			<div className={cn("h-full min-h-0 min-w-0 flex-1", open ? "flex" : "hidden lg:flex")}>
				<Outlet />
			</div>
		</>
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
