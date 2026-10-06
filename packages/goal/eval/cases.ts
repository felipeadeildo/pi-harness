// Cases cut from real sessions, each with what the timeline should look like after the call.
// Most come from a call that went wrong; the rest keep the fix from breaking what worked.
import { GOAL_VERSION, type GoalItem, type ItemStatus, type SessionGoal } from "@adeildo/pi-kit";

import type { UpdateRequest } from "../src/prompts.ts";
import { withSkills } from "../src/transcript.ts";

export interface Expect {
	/** Items that end done. */
	done?: string[];
	/** Items that must stay open: not done, not dropped. */
	open?: string[];
	/** Items that end in later. */
	later?: string[];
	dropped?: string[];
	/** `empty`, `set`, an item id, or a pattern the step's text matches. */
	now?: string | RegExp;
	/** No item is added. */
	noNew?: boolean;
	/** A pattern the goal must not match. */
	goalNot?: RegExp;
	/** The goal says more than the step under way. */
	goalAboveNow?: boolean;
	/** Some open item, or the note of any item, says this. */
	mentions?: RegExp;
}

/** The pass after a run: the timeline and what was said and done since the last one. */
export interface TidyRequest {
	trigger: "tidy";
	state: SessionGoal;
	session: string;
}

export interface Case {
	name: string;
	/** What went wrong, or what must keep working. */
	why: string;
	request: UpdateRequest | TidyRequest;
	expect: Expect;
}

type Row = [id: string, status: ItemStatus, text: string, note?: string];

function timeline(
	goal: string | undefined,
	rows: Row[] = [],
	language = "Portuguese",
): SessionGoal {
	const items = rows.map(([id, status, text, note]): GoalItem => {
		const item: GoalItem = { id, status, text, source: "you", createdAt: 0, updatedAt: 0 };
		if (note !== undefined) item.note = note;
		return item;
	});
	const next = Math.max(0, ...rows.map(([id]) => Number(id.slice(1)))) + 1;
	return {
		version: GOAL_VERSION,
		items,
		nextId: next,
		updatedAt: 0,
		language,
		...(goal === undefined ? {} : { goal, goalSource: "you" as const }),
	};
}

const goalHistory: Row[] = [
	["g1", "done", "Mostrar o goal na faixa de cima"],
	["g2", "done", "Fazer commit e push do pi-goal"],
	["g3", "later", "Publicar o placeholder do pi-goal no npm", "precisa do 2FA"],
	["g4", "later", "Mergear o PR de release e acompanhar o workflow"],
	["g5", "done", "Corrigir os contadores que somem na faixa"],
];

export const CASES: Case[] = [
	{
		name: "a proposal is not a step",
		why: "The agent listed a next step and asked; the updater started it and named the goal after it.",
		request: {
			state: timeline(undefined),
			trigger: "work",
			asked: "qual o proximo paso?",
			news: [
				"call: bash git log -12 --format='%h %ad %s'; ls; grep -n -i -A25 'goal' ROADMAP.md",
				"call: bash sed -n 1,64p ROADMAP.md; ls packages; gh run list -L 3",
				"said: Neste repositório, o próximo passo é fechar o que ficou aberto da rodada do `goal` de hoje: `main` está em `52c83b9`, sem mudanças locais. O PR do release **5.6.0** foi aberto às 22:30 UTC. **Próximo passo (curto):** 1. **Mergear o release 5.6.0.** Antes, rodo o verify local. 2. **Atualizar o `ROADMAP.md`**. Quer que eu faça 1 a 3 agora?",
			].join("\n"),
		},
		expect: { now: "empty", noNew: true, goalNot: /merg/i },
	},
	{
		name: "moving on is not done",
		why: "The operator moved to another task; the updater finished the merge with 'mergeado com sucesso'.",
		request: {
			state: timeline("Mergear release 5.6.0", [["g1", "now", "Mergear o PR de release 5.6.0"]]),
			trigger: "message",
			news: "vamos atualizar o roadmap",
		},
		expect: { open: ["g1"], now: /roadmap/i },
	},
	{
		name: "waiting on the operator is not done",
		why: "The agent edited and asked to commit; the updater started and finished the step with 'Aguardando commit'.",
		request: {
			state: timeline("Atualizar o roadmap", [
				["g1", "later", "Mergear o PR de release 5.6.0"],
				["g2", "now", "Atualizar o roadmap"],
			]),
			trigger: "work",
			asked: "vamos atualizar o roadmap",
			news: [
				'call: codemode {"code":"tools.read({path:\\"ROADMAP.md\\"})"}',
				"call: bash cat lefthook.yml",
				"said: Agora edito: o item do juiz vira `done`, entra a seção do goal.",
				"call: edit ROADMAP.md",
				"call: bash bunx oxfmt ROADMAP.md && git diff --stat",
				"said: Atualizei o `ROADMAP.md`, mas ainda não fiz commit. Posso fazer o commit como `docs(roadmap): add the goal`?",
			].join("\n"),
		},
		expect: { open: ["g1", "g2"], now: "g2", noNew: true },
	},
	{
		name: "a question finishes nothing",
		why: "The operator asked a question; the updater finished the merge with 'PR de release merged e workflow monitorado'.",
		request: {
			state: timeline("Deixar o pi-goal pronto para usar", [
				...goalHistory.filter(([id]) => id !== "g4"),
				["g4", "now", "Mergear o PR de release e acompanhar o workflow"],
			]),
			trigger: "message",
			news: "ja apareceu ja...\n\nme diz uma coisa, ja estamos passando o intent ai pro judge?",
		},
		expect: { open: ["g3", "g4"], noNew: true },
	},
	{
		name: "criticism is not verification",
		why: "The operator criticised how items are worded; the updater finished three items with 'Verificado: ...'.",
		request: {
			state: timeline(undefined, [
				["g1", "done", "Rodar simplify e unslop no código"],
				["g2", "later", "Confirmar a persistência do estado após reload"],
				["g3", "later", "Testar a quebra de linha do goal na TUI"],
			]),
			trigger: "message",
			news: 'e outra coisa, nao precisa ser algo muito especifico... saca?\n\npor exemplo esse "automatizando correcoes no updater"\n\ntipo... pra que serve isso no longo prazo? nao da nenhuma informacao para quem for ler a sessao so por essas nossas notas... saca?',
		},
		expect: { open: ["g2", "g3"], noNew: true },
	},
	{
		name: "a summary repeats done work",
		why: "The agent summed up work already done; the updater started it again.",
		request: {
			state: timeline("Deixar o pi-goal pronto para usar", [
				...goalHistory,
				["g6", "done", "Arredondar os cantos da janela do Alt+G"],
			]),
			trigger: "work",
			asked: "outra coisa essa janelinha do Alt+G poderia ser pontas redondas tbm... saca?",
			news: "said: Corrigi os dois e já fiz push: `1566bf6` está no GitHub, e o `verify` passa (776 testes). Os cantos da janela do Alt+G agora são arredondados.",
		},
		expect: { now: "empty", noNew: true },
	},
	{
		name: "an ask that waits in later resumes it",
		why: "The operator asked for the Alt+G view that waited in later; the updater added a second item for it.",
		request: {
			state: timeline("Deixar o pi-goal pronto para usar", [
				...goalHistory,
				["g6", "later", "Adicionar visualização da sessão (Alt+G)"],
			]),
			trigger: "message",
			news: "beleza, vamos fazer isso do Alt+G, vai ficar bonitao, ok?",
		},
		expect: { now: "g6", noNew: true },
	},
	{
		name: "investigating a problem is a step",
		why: "The operator asked to find out what went wrong; the updater only changed the goal and left now empty.",
		request: {
			state: timeline("Atualizar o roadmap", [
				["g1", "done", "Mergear o PR de release 5.6.0"],
				["g2", "done", "Atualizar o roadmap"],
			]),
			trigger: "message",
			news: "acho que temos alguma coisa errada... nessa conversa daqui, recebemos o done no mergear... mas nao foi mergeado... vamos verificar oq aconteceu nessa sessao; e sim, pode fazer commit;",
		},
		expect: { now: "set" },
	},
	{
		name: "the goal sits above the step",
		why: "The goal was a copy of the step ('Mergear release 5.6.0' over 'Mergear o PR de release 5.6.0').",
		request: {
			state: timeline(undefined),
			trigger: "message",
			news: "vamos montar uma avaliação do goal com dados das sessões e depois simplificar o prompt e a tool, pra o haiku parar de inventar coisa",
		},
		expect: { now: "set", goalAboveNow: true },
	},
	{
		name: "a skill the operator names is the step",
		why: "The operator sent only '/skill:simplify e /skill:unslop'; the updater saw a bare command and changed nothing.",
		request: {
			state: timeline("Facilitar a classificação do goal", [
				["g1", "done", "Montar a avaliação do goal com casos reais"],
				["g2", "done", "Simplificar as operações do goal"],
			]),
			trigger: "message",
			news: withSkills(" /skill:simplify  e /skill:unslop", [
				{
					name: "simplify",
					description:
						"Simplify and refine recently modified code for clarity and consistency. Use after writing code to improve readability without changing functionality.",
				},
				{ name: "unslop", description: "Edit text to remove AI patterns." },
			]),
		},
		// Two asks: one is the step, the other waits in later.
		expect: { now: "set", mentions: /simplif|refin/i },
	},
	{
		name: "the operator says it is done",
		why: "Must keep working: the operator ran it, so the step is done.",
		request: {
			state: timeline("Publicar o pi-goal", [
				["g1", "done", "Fazer commit e push do pi-goal"],
				["g2", "now", "Publicar o placeholder do pi-goal no npm"],
			]),
			trigger: "message",
			news: "publiquei o placeholder agora, rodei o npm publish com o 2FA e já aparece no npm",
		},
		expect: { done: ["g2"] },
	},
	{
		name: "work that finished is done",
		why: "Must keep working: the agent made the change, tested it and pushed it.",
		request: {
			state: timeline("Deixar o pi-goal pronto para usar", [
				["g1", "done", "Mostrar o goal na faixa de cima"],
				["g2", "now", "Arredondar os cantos da janela do Alt+G"],
			]),
			trigger: "work",
			asked: "essa janelinha do Alt+G poderia ser pontas redondas tbm... saca?",
			news: [
				"call: edit packages/goal/src/view.ts",
				"call: bash bun run verify",
				"said: Os cantos da janela agora são arredondados (╭╮╰╯), o verify passa (776 testes).",
				"call: bash git commit -qm 'fix(goal): round the Alt+G panel corners' && git push",
				"said: Pronto, `1566bf6` está no GitHub.",
			].join("\n"),
		},
		expect: { done: ["g2"], noNew: true },
	},
	{
		name: "a deferred step goes to later",
		why: "Must keep working: the operator put the step off.",
		request: {
			state: timeline("Deixar o pi-goal pronto para usar", [
				["g1", "done", "Mostrar o goal na faixa de cima"],
				["g2", "now", "Moldurar a mensagem do usuário"],
			]),
			trigger: "message",
			news: "deixa a moldura da mensagem pra depois, quero primeiro arrumar os contadores que somem",
		},
		expect: { later: ["g2"], now: /contador/i },
	},
	{
		name: "a step the operator gives up is dropped",
		why: "Must keep working: the operator no longer wants it.",
		request: {
			state: timeline("Publicar o pi-goal", [
				["g1", "done", "Fazer commit e push do pi-goal"],
				["g2", "later", "Publicar o placeholder do pi-goal no npm"],
			]),
			trigger: "message",
			news: "esquece o placeholder do npm, não precisa mais, o release já publica o pacote de verdade",
		},
		expect: { dropped: ["g2"] },
	},
	{
		name: "a follow-up the agent leaves goes to later",
		why: "Must keep working: the agent finished and named what is left.",
		request: {
			state: timeline("Avaliar o goal com dados", [["g1", "now", "Montar a avaliação do goal"]]),
			trigger: "work",
			asked: "pode seguir",
			news: [
				"call: write packages/goal/eval/run.ts",
				"call: bash bun packages/goal/eval/run.ts",
				"said: A avaliação roda: 14 casos, 9 passam com o prompt atual. Ficou faltando documentar como rodar no README, faço depois do prompt novo.",
			].join("\n"),
		},
		expect: { mentions: /readme|document/i },
	},
	{
		name: "tidy: a repeat of done work is closed as the same",
		why: "Must keep working: an open item that repeats a done one is finished, not left open.",
		request: {
			trigger: "tidy",
			state: timeline("Deixar o pi-goal pronto para usar", [
				["g1", "done", "Arredondar os cantos da janela do Alt+G"],
				["g2", "later", "Deixar a janela do Alt+G com pontas redondas"],
				["g3", "later", "Moldurar a mensagem do usuário"],
			]),
			session: [
				"operator: essa janelinha do Alt+G poderia ser pontas redondas tbm",
				"said: Os cantos da janela agora são arredondados, e o verify passa.",
			].join("\n"),
		},
		expect: { done: ["g2"], open: ["g3"] },
	},
	{
		name: "tidy: nothing in the session, nothing closes",
		why: "The tidy pass finished items with 'Verificado: ...' that the session never showed.",
		request: {
			trigger: "tidy",
			state: timeline(undefined, [
				["g1", "done", "Rodar simplify e unslop no código"],
				["g2", "later", "Confirmar a persistência do estado após reload"],
				["g3", "later", "Testar a quebra de linha do goal na TUI"],
			]),
			session: [
				'operator: e outra coisa, nao precisa ser algo muito especifico... por exemplo esse "automatizando correcoes no updater" nao da nenhuma informacao para quem for ler a sessao',
				"said: O ponto é bom: o item tem que dizer o resultado para quem lê a sessão depois. Mudo o prompt para pedir isso.",
			].join("\n"),
		},
		expect: { open: ["g2", "g3"], noNew: true },
	},
];
