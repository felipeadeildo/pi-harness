// The page's small shared pieces: icons, the terminal's status marks, the clock, and the sheet that
// rises from the bottom on a phone and slides in from the right on a wide screen.
import {
	AlertCircleIcon,
	ArrowLeft01Icon,
	Cancel01Icon,
	Flag02Icon,
	MinusSignCircleIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { cn } from "cn";
import {
	type CSSProperties,
	type ReactNode,
	useEffect,
	useState,
	useSyncExternalStore,
} from "react";

import { Button } from "@/components/ui/button";
import {
	Drawer,
	DrawerClose,
	DrawerContent,
	DrawerDescription,
	DrawerHeader,
	DrawerTitle,
} from "@/components/ui/drawer";
import type { Mark } from "@/session/rows.ts";

export function Icon({
	icon,
	className,
	strokeWidth = 1.75,
}: {
	icon: IconSvgElement;
	className?: string;
	strokeWidth?: number;
}): ReactNode {
	return (
		<HugeiconsIcon
			icon={icon}
			strokeWidth={strokeWidth}
			className={cn("size-4 shrink-0", className)}
		/>
	);
}

/** Filled and breathing while it works, a ring while idle, a flag when it waits on you. */
export function StatusMark({ mark, className }: { mark: Mark; className?: string }): ReactNode {
	switch (mark) {
		case "waits":
			return (
				<Icon icon={Flag02Icon} className={cn("size-4 text-waits", className)} strokeWidth={2} />
			);
		case "error":
			return (
				<Icon
					icon={AlertCircleIcon}
					className={cn("size-4 text-destructive", className)}
					strokeWidth={2}
				/>
			);
		case "closed":
			return <Icon icon={MinusSignCircleIcon} className={cn("size-4 text-dim", className)} />;
		case "working":
			return (
				<span
					aria-hidden="true"
					className={cn("relative flex size-4 shrink-0 items-center justify-center", className)}
				>
					<span className="absolute size-2.5 rounded-full bg-pi/40 motion-safe:animate-ping" />
					<span className="relative size-2 rounded-full bg-pi" />
				</span>
			);
		case "idle":
			return (
				<span
					aria-hidden="true"
					className={cn("flex size-4 shrink-0 items-center justify-center", className)}
				>
					<span className="size-2 rounded-full border-[1.5px] border-dim" />
				</span>
			);
	}
}

/** A name in the color the room gave its agent. */
export function AgentName({
	name,
	color,
	className,
}: {
	name: string;
	color: string | undefined;
	className?: string;
}): ReactNode {
	const style: CSSProperties | undefined = color === undefined ? undefined : { color };
	return (
		<span className={cn("wide truncate font-semibold", className)} style={style}>
			{name}
		</span>
	);
}

/** Ticks while something on screen counts time. */
export function useNow(every = 1000, ticking = true): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!ticking) return undefined;
		const timer = setInterval(() => setNow(Date.now()), every);
		return () => clearInterval(timer);
	}, [every, ticking]);
	return now;
}

const WIDE = "(min-width: 768px)";

function subscribeWide(changed: () => void): () => void {
	const query = matchMedia(WIDE);
	query.addEventListener("change", changed);
	return () => query.removeEventListener("change", changed);
}

export function useWide(): boolean {
	return useSyncExternalStore(
		subscribeWide,
		() => matchMedia(WIDE).matches,
		() => false,
	);
}

/** One sheet for every picker and panel: from the bottom on a phone, from the right when wide. */
export function Panel({
	open,
	onOpenChange,
	title,
	description,
	children,
	className,
	tall = false,
	back,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	description?: string;
	children: ReactNode;
	className?: string;
	/** A fixed height on a phone, for content that changes under the reader's finger. */
	tall?: boolean;
	/** A view inside the sheet goes back to the one it came from. */
	back?: () => void;
}): ReactNode {
	const wide = useWide();
	return (
		<Drawer
			open={open}
			onOpenChange={onOpenChange}
			swipeDirection={wide ? "right" : "down"}
			showSwipeHandle={!wide}
		>
			<DrawerContent
				className={cn(
					wide && "[--drawer-content-width:28rem]",
					tall && !wide && "[--drawer-content-height:82dvh]",
					className,
				)}
			>
				<DrawerHeader className="flex-row items-start gap-3 pb-3 text-left group-data-[swipe-axis=y]/drawer-popup:text-left">
					{back === undefined ? null : (
						<Button
							variant="ghost"
							size="icon"
							aria-label="Back"
							className="-ml-2 -mt-1"
							onClick={back}
						>
							<Icon icon={ArrowLeft01Icon} />
						</Button>
					)}
					<div className="min-w-0 flex-1">
						<DrawerTitle className="wide text-[17px] font-semibold">{title}</DrawerTitle>
						{description === undefined ? null : (
							<DrawerDescription className="text-muted-foreground">{description}</DrawerDescription>
						)}
					</div>
					<DrawerClose
						render={
							<Button variant="ghost" size="icon" aria-label="Close" className="-mr-1 -mt-1" />
						}
					>
						<Icon icon={Cancel01Icon} />
					</DrawerClose>
				</DrawerHeader>
				<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
					{children}
				</div>
			</DrawerContent>
		</Drawer>
	);
}
