// A ```mermaid block drawn as its diagram, in the page's colors and type, with its source a tap away
// and a full-screen view for a phone. Mermaid is loaded the first time a diagram shows.
import { CodeIcon, FlowConnectionIcon, SquareArrowExpand02Icon } from "@hugeicons/core-free-icons";
import { type ReactNode, useEffect, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useScheme } from "@/ui/use-scheme.ts";

import { Code } from "./code.tsx";
import { Icon } from "./kit.tsx";
import { PanZoom } from "./pan-zoom.tsx";

type Drawn = { svg: string; width: number } | { error: string } | undefined;

/** Mermaid scales its drawing down to the box; read its own width so a phone can scroll it instead. */
function natural(svg: string): { svg: string; width: number } {
	const width = Number(/max-width:\s*([\d.]+)px/.exec(svg)?.[1] ?? "0");
	return { svg: svg.replace(/\swidth="100%"/, "").replace(/max-width:\s*[\d.]+px;?/, ""), width };
}

const FONT = '"Mona Sans Variable", ui-sans-serif, system-ui, sans-serif';

let queue: Promise<unknown> = Promise.resolve();

/** Mermaid renders one diagram at a time; two at once share its scratch element and break. */
async function draw(id: string, code: string, dark: boolean): Promise<string> {
	const run = queue.then(async () => {
		const { default: mermaid } = await import("mermaid");
		mermaid.initialize({
			startOnLoad: false,
			securityLevel: "strict",
			theme: "base",
			fontFamily: FONT,
			themeVariables: dark
				? {
						darkMode: true,
						background: "#000000",
						primaryColor: "#161616",
						primaryTextColor: "#ececec",
						primaryBorderColor: "#3a3a3a",
						lineColor: "#8a8a8a",
						secondaryColor: "#1c1c1c",
						tertiaryColor: "#121212",
						noteBkgColor: "#1f1a2b",
						noteTextColor: "#ececec",
						fontFamily: FONT,
					}
				: {
						background: "#ffffff",
						primaryColor: "#f5f5f4",
						primaryTextColor: "#111111",
						primaryBorderColor: "#d4d4d2",
						lineColor: "#6b6b68",
						secondaryColor: "#f0f0ef",
						tertiaryColor: "#fafaf9",
						noteBkgColor: "#efeaf8",
						noteTextColor: "#111111",
						fontFamily: FONT,
					},
		});
		const { svg } = await mermaid.render(id, code);
		return svg;
	});
	queue = run.catch(() => undefined);
	return run;
}

export function Mermaid({ code, streaming }: { code: string; streaming: boolean }): ReactNode {
	const scheme = useScheme();
	const id = `mermaid-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
	const [drawn, setDrawn] = useState<Drawn>(undefined);
	const [source, setSource] = useState(false);
	const [full, setFull] = useState(false);

	useEffect(() => {
		if (streaming) return undefined;
		let open = true;
		draw(id, code, scheme === "dark")
			.then((svg) => open && setDrawn(natural(svg)))
			.catch(
				(error: unknown) =>
					open && setDrawn({ error: error instanceof Error ? error.message : String(error) }),
			);
		return () => {
			open = false;
		};
	}, [id, code, scheme, streaming]);

	if (streaming || source || drawn === undefined || "error" in drawn)
		return (
			<div className="flex flex-col gap-1.5">
				<Code
					code={code}
					language="text"
					size="sm"
					title={<Title drawing={!streaming && drawn === undefined} />}
				/>
				{drawn !== undefined && "error" in drawn ? (
					<p className="text-xs text-muted-foreground">
						The diagram does not parse: {drawn.error.split("\n")[0]}
					</p>
				) : null}
				{source && drawn !== undefined && "svg" in drawn ? (
					<Button variant="ghost" size="sm" className="w-fit" onClick={() => setSource(false)}>
						<Icon icon={FlowConnectionIcon} className="size-3.5" />
						Show the diagram
					</Button>
				) : null}
			</div>
		);

	const shown = drawn;
	return (
		<figure className="group/mermaid relative overflow-hidden rounded-lg border bg-raised">
			<button
				type="button"
				aria-label="Open the diagram to zoom"
				className="block w-full cursor-zoom-in"
				onClick={() => setFull(true)}
			>
				<Drawing svg={shown.svg} />
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
					<Zoomed svg={shown.svg} width={shown.width} />
				</DialogContent>
			</Dialog>
		</figure>
	);
}

/** The drawing scaled to the column, so a phone never scrolls it sideways; the full view zooms. */
function Drawing({ svg }: { svg: string }): ReactNode {
	return (
		<div
			className="max-h-[60vh] overflow-hidden p-4 [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-h-[calc(60vh-2rem)] [&_svg]:max-w-full"
			// Mermaid's own output, rendered with `securityLevel: "strict"`, which strips scripts and links.
			dangerouslySetInnerHTML={{ __html: svg }}
		/>
	);
}

/** The drawing at its own size, to move and zoom freely. */
function Zoomed({ svg, width }: { svg: string; width: number }): ReactNode {
	const box = /viewBox="[\d.-]+ [\d.-]+ ([\d.]+) ([\d.]+)"/.exec(svg);
	const natural = Number(box?.[1] ?? width);
	const tall = Number(box?.[2] ?? width);
	const shown = width === 0 ? natural : width;
	const high = natural === 0 ? tall : (tall * shown) / natural;
	return (
		<PanZoom width={shown} height={high}>
			<div
				className="size-full [&_svg]:size-full [&_svg]:max-w-none"
				// Mermaid's own output, rendered with `securityLevel: "strict"`, which strips scripts and links.
				dangerouslySetInnerHTML={{ __html: svg }}
			/>
		</PanZoom>
	);
}

function Title({ drawing }: { drawing: boolean }): ReactNode {
	return (
		<span className="flex items-center gap-1.5 font-sans text-xs text-muted-foreground">
			<Icon icon={FlowConnectionIcon} className="size-3.5" />
			{drawing ? "Drawing the diagram…" : "mermaid"}
		</span>
	);
}
