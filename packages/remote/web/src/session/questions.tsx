// The question the agent asked, answerable from the phone.
import type { OpenAsk } from "@adeildo/pi-remote-protocol";
import type { Client } from "@adeildo/pi-remote-protocol/client";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";

import { Primary } from "../ui/controls.tsx";
import { answerAsk, type Draft, EMPTY, pick, ready, type } from "./answers.ts";
import { cap } from "./panel.ts";

export function QuestionDialog({ ask, client }: { ask: OpenAsk; client: Client }): ReactNode {
	const [draft, setDraft] = useState<Draft>(EMPTY);
	const [index, setIndex] = useState(0);
	const [tallest, setTallest] = useState(0);
	const panel = useRef<HTMLDivElement>(null);
	const one = ask.questions[index];
	const last = index === ask.questions.length - 1;

	// A floor that only rises, so a shorter question does not move the composer.
	useLayoutEffect(() => {
		const height = panel.current?.offsetHeight ?? 0;
		setTallest((was) => cap(was, height));
	});

	return (
		<div className="question" style={{ minHeight: tallest === 0 ? undefined : tallest }}>
			<div ref={panel} className="question-panel">
				<div className="question-head">
					<span className="name">{one?.header ?? "A question"}</span>
					<span className="quiet">
						{index + 1} of {ask.questions.length}
					</span>
				</div>
				<p>{one?.question}</p>
				{(one?.options ?? []).map((option) => {
					const chosen = (draft.picks[index] ?? []).includes(option.label);
					return (
						<button
							type="button"
							key={option.label}
							className={chosen ? "choice chosen" : "choice"}
							aria-pressed={chosen}
							onClick={() => setDraft((was) => pick(was, index, option.label, one?.multiSelect))}
						>
							<span className="name">{option.label}</span>
							{option.description === undefined ? null : (
								<span className="quiet">{option.description}</span>
							)}
						</button>
					);
				})}
				{one?.typed === false ? null : (
					<input
						type="text"
						aria-label="Answer in your own words"
						placeholder="Or say it in your own words"
						value={draft.typed[index] ?? ""}
						onChange={(event) => setDraft((was) => type(was, index, event.target.value))}
					/>
				)}
				<div className="question-actions">
					{index === 0 ? null : (
						<button type="button" className="action" onClick={() => setIndex(index - 1)}>
							Back
						</button>
					)}
					{last ? (
						<Primary
							label="Send answer"
							disabled={!ready(ask, draft)}
							onPress={() => answerAsk(client, ask, draft)}
						/>
					) : (
						<button type="button" className="action" onClick={() => setIndex(index + 1)}>
							Next
						</button>
					)}
				</div>
			</div>
		</div>
	);
}
