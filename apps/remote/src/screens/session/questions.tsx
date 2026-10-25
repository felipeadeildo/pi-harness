// The question the agent asked, answerable from the phone: this is the case the whole remote exists
// for ("the agent needs a decision while I am away"), so the screen has to be usable with one hand.

import type { Client } from "@adeildo/pi-remote-client";
import type { OpenAsk } from "@adeildo/pi-remote-protocol";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { answerAsk, EMPTY, pick, ready, type, type Draft } from "./answers.ts";
import { cap } from "./panel.ts";

export function QuestionDialog({ ask, client }: { ask: OpenAsk; client: Client }): React.ReactNode {
	const [draft, setDraft] = useState<Draft>(EMPTY);
	const [index, setIndex] = useState(0);
	const [tallest, setTallest] = useState(0);
	const one = ask.questions[index];
	const last = index === ask.questions.length - 1;

	return (
		// A floor, not a fixed height: the panel grows with its content and never drops below the tallest
		// it has been. A fixed height would constrain the child, so the measurement would come back
		// already cut and the panel would never grow again.
		<View style={{ minHeight: tallest === 0 ? undefined : tallest }}>
			<View
				onLayout={(event) => {
					const { height } = event.nativeEvent.layout;
					setTallest((was) => cap(was, height));
				}}
				style={{ gap: 8, padding: 16, borderTopWidth: 1, borderColor: "#ddd" }}
			>
				<View style={{ flexDirection: "row", justifyContent: "space-between" }}>
					<Text style={{ fontWeight: "600" }}>{one?.header ?? "A question"}</Text>
					<Text>
						{index + 1} of {ask.questions.length}
					</Text>
				</View>
				<Text>{one?.question}</Text>
				{(one?.options ?? []).map((option) => {
					const chosen = (draft.picks[index] ?? []).includes(option.label);
					return (
						<Pressable
							key={option.label}
							accessibilityRole="button"
							accessibilityState={{ selected: chosen }}
							onPress={() => setDraft((was) => pick(was, index, option.label, one?.multiSelect))}
							style={{
								padding: 12,
								borderRadius: 8,
								borderWidth: 1,
								borderColor: chosen ? "#333" : "#ddd",
								backgroundColor: chosen ? "#f0f0f0" : "transparent",
							}}
						>
							<Text style={{ fontWeight: "600" }}>{option.label}</Text>
							{option.description === undefined ? null : <Text>{option.description}</Text>}
						</Pressable>
					);
				})}
				{one?.typed === false ? null : (
					<TextInput
						accessibilityLabel="Answer in your own words"
						placeholder="Or say it in your own words"
						value={draft.typed[index] ?? ""}
						onChangeText={(text) => setDraft((was) => type(was, index, text))}
						style={{ padding: 12, borderWidth: 1, borderColor: "#ddd", borderRadius: 8 }}
					/>
				)}
				<View style={{ flexDirection: "row", gap: 8, justifyContent: "flex-end" }}>
					{index === 0 ? null : (
						<Pressable accessibilityRole="button" onPress={() => setIndex(index - 1)}>
							<Text>Back</Text>
						</Pressable>
					)}
					{last ? (
						<Pressable
							accessibilityRole="button"
							disabled={!ready(ask, draft)}
							onPress={() => answerAsk(client, ask, draft)}
						>
							<Text>Send answer</Text>
						</Pressable>
					) : (
						<Pressable accessibilityRole="button" onPress={() => setIndex(index + 1)}>
							<Text>Next</Text>
						</Pressable>
					)}
				</View>
			</View>
		</View>
	);
}
