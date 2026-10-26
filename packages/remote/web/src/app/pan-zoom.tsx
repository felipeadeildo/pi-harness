// A picture you can move and zoom freely: drag or one finger to pan, pinch or the wheel to zoom
// around the point under it, a double tap to fit it again.
import { MinusSignIcon, PlusSignIcon, SquareArrowShrink02Icon } from "@hugeicons/core-free-icons";
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

import { Icon } from "./kit.tsx";

interface View {
	x: number;
	y: number;
	scale: number;
}

const MIN = 0.1;
const MAX = 8;

function clamp(scale: number): number {
	return Math.min(MAX, Math.max(MIN, scale));
}

export function PanZoom({
	width,
	height,
	children,
}: {
	width: number;
	height: number;
	children: ReactNode;
}): ReactNode {
	const frame = useRef<HTMLDivElement>(null);
	const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1 });
	const pointers = useRef(new Map<number, { x: number; y: number }>());
	const pinch = useRef<{ distance: number; scale: number } | undefined>(undefined);

	const fit = useCallback((): void => {
		const box = frame.current?.getBoundingClientRect();
		if (box === undefined || width === 0 || height === 0) return;
		const scale = clamp(Math.min(box.width / width, box.height / height) * 0.94);
		setView({ scale, x: (box.width - width * scale) / 2, y: (box.height - height * scale) / 2 });
	}, [width, height]);

	useLayoutEffect(fit, [fit]);

	/** Zooms by `factor` keeping the point at (px, py), in the frame's coordinates, still. */
	const zoomAt = useCallback((factor: number, px: number, py: number): void => {
		setView((was) => {
			const scale = clamp(was.scale * factor);
			const real = scale / was.scale;
			return { scale, x: px - (px - was.x) * real, y: py - (py - was.y) * real };
		});
	}, []);

	useEffect(() => {
		const box = frame.current;
		if (box === null) return undefined;
		const wheel = (event: WheelEvent): void => {
			event.preventDefault();
			const at = box.getBoundingClientRect();
			zoomAt(Math.exp(-event.deltaY * 0.0015), event.clientX - at.left, event.clientY - at.top);
		};
		box.addEventListener("wheel", wheel, { passive: false });
		return () => box.removeEventListener("wheel", wheel);
	}, [zoomAt]);

	const center = (): { x: number; y: number } => {
		const box = frame.current?.getBoundingClientRect();
		return { x: (box?.width ?? 0) / 2, y: (box?.height ?? 0) / 2 };
	};

	return (
		<div className="relative flex min-h-0 flex-1 flex-col">
			<div
				ref={frame}
				className="relative min-h-0 flex-1 cursor-grab touch-none overflow-hidden rounded-md bg-raised select-none active:cursor-grabbing"
				onDoubleClick={fit}
				onPointerDown={(event) => {
					event.currentTarget.setPointerCapture(event.pointerId);
					pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
					if (pointers.current.size === 2) {
						const [a, b] = [...pointers.current.values()];
						if (a !== undefined && b !== undefined)
							pinch.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), scale: view.scale };
					}
				}}
				onPointerMove={(event) => {
					const held = pointers.current.get(event.pointerId);
					if (held === undefined) return;
					const moved = { x: event.clientX, y: event.clientY };
					pointers.current.set(event.pointerId, moved);
					if (pointers.current.size === 2 && pinch.current !== undefined) {
						const [a, b] = [...pointers.current.values()];
						if (a === undefined || b === undefined) return;
						const at = event.currentTarget.getBoundingClientRect();
						const distance = Math.hypot(a.x - b.x, a.y - b.y);
						const target = clamp((pinch.current.scale * distance) / pinch.current.distance);
						zoomAt(target / view.scale, (a.x + b.x) / 2 - at.left, (a.y + b.y) / 2 - at.top);
						return;
					}
					setView((was) => ({ ...was, x: was.x + moved.x - held.x, y: was.y + moved.y - held.y }));
				}}
				onPointerUp={(event) => {
					pointers.current.delete(event.pointerId);
					if (pointers.current.size < 2) pinch.current = undefined;
				}}
				onPointerCancel={(event) => {
					pointers.current.delete(event.pointerId);
					pinch.current = undefined;
				}}
			>
				<div
					className="absolute top-0 left-0 origin-top-left will-change-transform"
					style={{
						width,
						height,
						transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
					}}
				>
					{children}
				</div>
			</div>
			<div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-full border bg-popover p-1 shadow-lg">
				<Button
					variant="ghost"
					size="icon"
					className="size-9 rounded-full"
					aria-label="Zoom out"
					onClick={() => zoomAt(1 / 1.25, center().x, center().y)}
				>
					<Icon icon={MinusSignIcon} />
				</Button>
				<button
					type="button"
					onClick={fit}
					className="tabular w-14 rounded-full py-2 text-center text-xs hover:bg-muted"
					aria-label="Fit to the screen"
				>
					{Math.round(view.scale * 100)}%
				</button>
				<Button
					variant="ghost"
					size="icon"
					className="size-9 rounded-full"
					aria-label="Zoom in"
					onClick={() => zoomAt(1.25, center().x, center().y)}
				>
					<Icon icon={PlusSignIcon} />
				</Button>
				<Button
					variant="ghost"
					size="icon"
					className="size-9 rounded-full"
					aria-label="Fit to the screen"
					onClick={fit}
				>
					<Icon icon={SquareArrowShrink02Icon} />
				</Button>
			</div>
		</div>
	);
}
