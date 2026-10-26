// A sheet from the bottom edge, over the layout. Closes on the shade, Close and Escape.
import { type ReactNode, useEffect } from "react";

import { Action } from "./controls.tsx";

export function Sheet({
	title,
	onClose,
	children,
}: {
	title: string;
	onClose: () => void;
	children: ReactNode;
}): ReactNode {
	useEffect(() => {
		const key = (event: KeyboardEvent): void => {
			if (event.key === "Escape") onClose();
		};
		document.addEventListener("keydown", key);
		return () => document.removeEventListener("keydown", key);
	}, [onClose]);
	return (
		<div className="sheet-layer">
			<button type="button" className="shade" aria-label="Close" onClick={onClose} />
			<div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
				<h2>{title}</h2>
				<div className="sheet-body">{children}</div>
				<Action label="Close" onPress={onClose} />
			</div>
		</div>
	);
}
