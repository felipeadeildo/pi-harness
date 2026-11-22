// A ```mermaid block drawn as its diagram by Pele, in the page's colors and type, growing while the
// answer streams, with its source a tap away and a full-screen view to zoom on a phone. The colors
// are CSS variables (`.diagram` in app.css), so a scheme change recolors it without drawing again.
import { CodeIcon, FlowConnectionIcon, SquareArrowExpand02Icon } from "@hugeicons/core-free-icons";
import { type Mounted, mount } from "pele";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

import { Code } from "./code.tsx";
import { drawable } from "./diagram.ts";
import { Icon } from "./kit.tsx";

/** The full-screen view zooms a diagram that already fits, up to eight times its own size. */
const FULL_ZOOM = { always: true, maxScale: 8 };

export function Mermaid({ code, streaming }: { code: string; streaming: boolean }): ReactNode {
	const shown = useMemo(() => drawable(code, streaming), [code, streaming]);
	const [source, setSource] = useState(false);
	const [full, setFull] = useState(false);

	if (source || shown === undefined || "error" in shown)
		return (
			<div className="flex flex-col gap-1.5">
				<Code
					code={code}
					language="text"
					size="sm"
					title={<Title drawing={streaming && shown === undefined} />}
				/>
				{shown !== undefined && "error" in shown ? (
					<p className="text-xs text-muted-foreground">The diagram does not parse: {shown.error}</p>
				) : null}
				{source && shown !== undefined && "text" in shown ? (
					<Button variant="ghost" size="sm" className="w-fit" onClick={() => setSource(false)}>
						<Icon icon={FlowConnectionIcon} className="size-3.5" />
						Show the diagram
					</Button>
				) : null}
			</div>
		);

	return (
		<figure className="group/mermaid relative overflow-hidden rounded-lg border bg-raised">
			<button
				type="button"
				aria-label="Open the diagram to zoom"
				className="block w-full cursor-zoom-in"
				onClick={() => setFull(true)}
			>
				<Drawing
					text={shown.text}
					zoom={false}
					className="max-h-[60vh] overflow-hidden p-4 [&_svg]:mx-auto [&_svg]:max-h-[calc(60vh-2rem)]"
				/>
			</button>
			<div className="absolute top-2 right-2 flex gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover/mermaid:opacity-100 sm:group-focus-within/mermaid:opacity-100">
				<Button
					variant="secondary"
					size="icon-sm"
					aria-label="Show the source"
					onClick={() => setSource(true)}
				>
					<Icon icon={CodeIcon} className="size-3.5" />
				</Button>
				<Button
					variant="secondary"
					size="icon-sm"
					aria-label="Open full screen"
					onClick={() => setFull(true)}
				>
					<Icon icon={SquareArrowExpand02Icon} className="size-3.5" />
				</Button>
			</div>
			<Dialog open={full} onOpenChange={setFull}>
				<DialogContent className="flex h-[94dvh] w-[96vw] max-w-[96vw] flex-col gap-2 p-2 sm:max-w-[96vw]">
					<DialogTitle className="px-2 pt-1 text-sm">Diagram</DialogTitle>
					<Drawing
						text={shown.text}
						zoom={FULL_ZOOM}
						className="min-h-0 flex-1 [&_svg]:mx-auto [&_svg]:max-h-full"
					/>
				</DialogContent>
			</Dialog>
		</figure>
	);
}

/**
 * Pele draws into the element and lays the diagram out again when its width changes, so a phone gets
 * a narrower layout instead of a smaller one. Links and images in the source are not drawn.
 */
function Drawing({
	text,
	zoom,
	className,
}: {
	text: string;
	zoom: false | typeof FULL_ZOOM;
	className: string;
}): ReactNode {
	const host = useRef<HTMLDivElement>(null);
	const drawn = useRef<Mounted | undefined>(undefined);
	const latest = useRef(text);
	latest.current = text;

	useEffect(() => {
		if (host.current === null) return undefined;
		drawn.current = mount(host.current, latest.current, { zoom, links: false, images: false });
		return () => {
			drawn.current?.destroy();
			drawn.current = undefined;
		};
	}, [zoom]);

	useEffect(() => {
		if (drawn.current?.source !== text) drawn.current?.update(text);
	}, [text]);

	return <div ref={host} className={`diagram ${className}`} />;
}

function Title({ drawing }: { drawing: boolean }): ReactNode {
	return (
		<span className="flex items-center gap-1.5 font-sans text-xs text-muted-foreground">
			<Icon icon={FlowConnectionIcon} className="size-3.5" />
			{drawing ? "Drawing the diagram…" : "mermaid"}
		</span>
	);
}
