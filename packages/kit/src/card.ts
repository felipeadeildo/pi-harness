import { visibleWidth } from "@earendil-works/pi-tui";

export function spread(left: string, right: string, width: number): string {
	return `${left}${" ".repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(right)))}${right}`;
}
