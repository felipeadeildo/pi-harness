// The chrome beside the transcript: what the session is doing and what it waits on. It is React Native
// because a phone draws it with views, and nothing here is a document.
import type { OpenAsk, SessionState } from "@adeildo/pi-remote-protocol";
import { Text, View } from "react-native";

import { plain } from "../../render/index.ts";
import { theme } from "../../ui/theme.ts";
import { terminalWait } from "./panel-data.ts";

/** A question the session waits on, with its options, read from the state. */
export function OpenQuestions({ asks }: { asks: readonly OpenAsk[] }): React.ReactNode {
	if (asks.length === 0) return null;
	return (
		<View style={{ gap: theme.space(3), paddingVertical: theme.space(3) }}>
			{asks.map((ask) => (
				<View key={ask.id} style={{ gap: theme.space(1) }}>
					<Text style={{ ...theme.type.label, color: theme.color.text }}>
						Waiting for an answer
					</Text>
					{ask.questions.map((question, at) => (
						<View key={`${ask.id}:${at}`}>
							<Text style={{ ...theme.type.body, color: theme.color.text }}>
								<Text style={{ ...theme.type.label, color: theme.color.text }}>
									{plain(question.header)}
								</Text>
								{` ${plain(question.question)}`}
							</Text>
							{question.options.map((option, index) => (
								<Text
									key={`${at}:${index}`}
									style={{ ...theme.type.caption, color: theme.color.muted }}
								>
									{plain(option.label)}
								</Text>
							))}
						</View>
					))}
				</View>
			))}
		</View>
	);
}

/** The terminal is waiting on a dialog this screen cannot answer: it says so, and where to go. */
export function TerminalWait({ prompt }: { prompt: SessionState["prompt"] }): React.ReactNode {
	const line = terminalWait(prompt);
	if (line === undefined) return null;
	return (
		<View role="status" style={{ paddingVertical: theme.space(3) }}>
			<Text style={{ ...theme.type.label, color: theme.color.warn }}>{line}</Text>
		</View>
	);
}
