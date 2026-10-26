// The board a session keeps, above the conversation: what the agent is on and what waits. Native views
// and the theme's tokens, so the same file serves the phone and the browser.
import type { BoardView } from "@adeildo/pi-remote-protocol";
import { type ReactNode } from "react";
import { Text, View } from "react-native";

import { theme } from "../../ui/theme.ts";
import { boardLinesOf } from "./board-data.ts";

/** Nothing drawn when the session has no board: an empty board would claim there is nothing to do. */
export function Board({ board }: { board: BoardView | undefined }): ReactNode {
	const lines = boardLinesOf(board);
	if (lines === undefined || lines.open.length === 0) return null;
	return (
		<View style={{ gap: theme.space(1), paddingVertical: theme.space(2) }} testID="board">
			<Text style={{ ...theme.type.label, color: theme.color.muted }}>
				{`Board · ${lines.open.length} open · ${lines.backlog} backlog`}
			</Text>
			{lines.open.map((card) => (
				<View key={card.id} style={{ gap: theme.space(1) }}>
					<Text
						style={{ ...theme.type.body, color: theme.color.text }}
					>{`${card.column} · ${card.title}`}</Text>
					{card.blocked === undefined ? null : (
						<Text style={{ ...theme.type.caption, color: theme.color.warn }}>{card.blocked}</Text>
					)}
				</View>
			))}
		</View>
	);
}
