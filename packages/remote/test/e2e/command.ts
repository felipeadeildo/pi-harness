// The command path end to end, against a daemon and a real pi: a prompt from a client reaches the
// session, the session answers, and the reply comes back on the command's id.
const cookie = process.argv[2] ?? "";
const port = Number(process.argv[3] ?? 0);
const session = process.argv[4] ?? "";
const origin = `http://127.0.0.1:${port}`;
const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
	headers: { Origin: origin, Cookie: cookie },
});
const heard: { kind?: string; type: string; id?: string; data?: unknown }[] = [];
let step = 0;

function send(kind: string, type: string, data: unknown, id?: string): void {
	ws.send(
		JSON.stringify({
			v: 1,
			kind,
			type,
			data,
			at: Date.now(),
			machine: "ghost",
			session,
			...(id ? { id } : {}),
		}),
	);
}

ws.onmessage = (event) => {
	const message = JSON.parse(String(event.data)) as {
		kind?: string;
		type: string;
		id?: string;
		data?: unknown;
	};
	heard.push(message);
	if (step === 0 && message.type === "snapshot") {
		step = 1;
		send(
			"command",
			"prompt.send",
			{ text: "say hello from the phone", deliverAs: "followUp" },
			"c1",
		);
		return;
	}
	if (step === 1 && message.kind === "reply" && message.id === "c1") {
		step = 2;
		send("command", "queue.clear", {}, "c2");
		return;
	}
	if (step === 2 && message.kind === "reply" && message.id === "c2") {
		const types = heard.map((one) => one.type);
		console.log(
			JSON.stringify(
				{
					reply: message,
					ran: types.includes("pi.message_start"),
					answered: types.includes("pi.message_end"),
					entry: types.includes("entry"),
					types: [...new Set(types)],
				},
				null,
				2,
			),
		);
		process.exit(0);
	}
};

ws.onopen = () => send("hello", "hello", { protocol: 1, cursor: undefined });
setTimeout(() => {
	console.log(
		JSON.stringify({ timedOut: true, types: [...new Set(heard.map((one) => one.type))] }, null, 2),
	);
	process.exit(1);
}, 25_000);
