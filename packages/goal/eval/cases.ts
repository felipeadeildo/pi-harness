// Cases cut from real sessions, each with what the timeline should look like after the call.
// Most come from a call that went wrong; the rest keep the fix from breaking what worked.
import { GOAL_VERSION, type GoalItem, type ItemStatus, type SessionGoal } from "@adeildo/pi-kit";

import type { UpdateRequest } from "../src/prompts.ts";
import { FAILED, type Line, withSkills } from "../src/transcript.ts";

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
	/** Lines with a time, when the case needs to say what came before an item. */
	session: string | Line[];
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

/** The items written down at `at`, for a case that says what came before them. */
function writtenAt(state: SessionGoal, at: number): SessionGoal {
	return { ...state, items: state.items.map((item) => ({ ...item, createdAt: at })) };
}

export const CASES: Case[] = [
	{
		name: "a proposal is not a step",
		why: "The agent listed a next step and asked; the updater started it and named the goal after it.",
		request: {
			state: timeline(undefined),
			trigger: "work",
			final: true,
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
		name: "work that waits only on a commit is done, and says so",
		why: "The agent edited the roadmap and asked to commit; the updater started and finished it at once with 'Aguardando commit'. The edit is the step, the commit is what is left.",
		request: {
			state: timeline("Atualizar o roadmap", [
				["g1", "later", "Mergear o PR de release 5.6.0"],
				["g2", "now", "Atualizar o roadmap"],
			]),
			trigger: "work",
			final: true,
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
		expect: { open: ["g1"], done: ["g2"], mentions: /commit/i },
	},
	{
		name: "a step whose own work waits on the operator stays open",
		why: "The step is the merge, and the agent stopped to ask before merging.",
		request: {
			state: timeline("Publicar o 5.6.0", [
				["g1", "done", "Fazer push das mudanças"],
				["g2", "now", "Fazer merge do PR de release 5.6.0"],
			]),
			trigger: "work",
			final: true,
			asked: "ve se o PR de release ta pronto pra merge",
			news: [
				"call: bash gh pr view 29 --json mergeable,statusCheckRollup",
				"said: O PR #29 está verde e sem conflitos, pronto para o merge. Posso fazer o merge em squash?",
			].join("\n"),
		},
		expect: { open: ["g2"], now: "g2" },
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
		name: "a refused call finishes nothing",
		why: "The operator refused the agent's call before the merge; the updater finished the merge with the command as proof.",
		request: {
			state: timeline("Publicar o 5.6.0", [
				["g1", "done", "Fazer push das mudanças"],
				["g2", "now", "Fazer merge do PR de release 5.6.0"],
			]),
			trigger: "work",
			asked: "pode fazer merge certinho;",
			news: `call: bash gh pr list --state open --json number,title,headRefName,mergeable,files ${FAILED}`,
		},
		expect: { open: ["g2"], now: "g2" },
	},
	{
		name: "a call alone is not proof",
		why: "The updater finished a push with the command line as proof, before its result came back.",
		request: {
			state: timeline("Publicar o 5.6.0", [
				["g1", "done", "Fazer commit das mudanças"],
				["g2", "now", "Fazer push das mudanças"],
			]),
			trigger: "work",
			asked: "ok vamos fazer push",
			news: 'call: bash git push 2>&1 | grep -E "pass$|fail$" ; git status -sb | head -1',
		},
		expect: { open: ["g2"], now: "g2" },
	},
	{
		name: "a message with two asks opens the first",
		why: "The operator asked to investigate the session, then to fix a border; the second start pushed the first to later.",
		request: {
			state: timeline("Facilitar a classificação do goal", [
				["g1", "done", "Rodar simplify e code-review nas mudanças"],
			]),
			trigger: "message",
			news: "beleza, agora vamos investigar oq aconteceu com essa sessao atual nossa... pq tipo assim tem umas ai que errou feio...\n\ne ainda tem mais, tem umas ascii de borda ai que por algum motivo ta quebrado... saca?",
		},
		expect: { now: /investig|sess/i, mentions: /borda|ascii/i },
	},
	{
		name: "a done step the operator says did not happen opens again",
		why: "The operator said the merge marked done never happened; the updater started a new merge step instead.",
		request: {
			state: timeline("Publicar o 5.6.0", [
				["g1", "done", "Fazer push das mudanças"],
				["g2", "done", "Fazer merge certinho", "resultado do comando para confirmar o merge"],
			]),
			trigger: "message",
			news: "pq que isso dai foi marcado como feito, se o merge NAO foi feito? tipo, eu cancelei o uso da tool especifica la",
		},
		expect: { open: ["g2"], noNew: true },
	},
	{
		name: "an idea marked done is dropped when the operator gives it up",
		why: "Ideas the session only discussed were marked done, and nothing could take them back.",
		request: {
			state: timeline("Deixar o pi-goal pronto para usar", [
				["g1", "done", "Mostrar o goal na faixa de cima"],
				["g2", "done", "Atualizar o intent em tempo real com polling"],
			]),
			trigger: "message",
			news: "esse do polling ai nao foi feito, foi so uma ideia que a gente teve, nao vamos fazer isso",
		},
		expect: { dropped: ["g2"], noNew: true },
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
			final: true,
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
			final: true,
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
		name: "what a finished step leaves is its missing, not a new item",
		why: "The agent finished the step and named what it does after; the updater also wrote it down as a new later item.",
		request: {
			state: timeline("Avaliar o goal com dados", [["g1", "now", "Montar a avaliação do goal"]]),
			trigger: "work",
			final: true,
			asked: "pode seguir",
			news: [
				"call: write packages/goal/eval/run.ts",
				"call: bash bun packages/goal/eval/run.ts",
				"said: A avaliação roda: 14 casos, 9 passam com o prompt atual. Ficou faltando documentar como rodar no README, faço depois do prompt novo.",
			].join("\n"),
		},
		expect: { done: ["g1"], noNew: true, mentions: /readme|document/i },
	},
	{
		name: "a line about what comes next is not proof",
		why: "Mid-run, the updater finished the research with 'Vou guardar a pesquisa em ...', a plan.",
		request: {
			state: timeline("Resolver problemas do sistema de goal", [
				["g1", "done", "Fazer push do código"],
				["g2", "now", "Pesquisar implementações de recap/goal/todo list para agentes"],
			]),
			trigger: "work",
			asked:
				"anyway, pesquisa na internet sobre como outros implementaram isso que a gente esta implementando, tbm pode ser chamado de recap, goal, todo list",
			news: [
				"said: Vou guardar a pesquisa em `packages/goal/docs/prior-art.md`, no mesmo formato do `quota.md` dos providers, para ficar no repo:",
				"call: write /home/adeildo/Projects/pi-harness/packages/goal/docs/prior-art.md",
				"call: bash bunx oxfmt packages/goal/docs/prior-art.md 2>&1 | tail -2",
				'call: memory_write {"target":"daily","content":"[[pi-harness]] [[pi-goal]] 06/10 noite: push…',
			].join("\n"),
		},
		expect: { open: ["g2"], now: "g2" },
	},
	{
		name: "what the agent will look at next is not proof",
		why: "Mid-run, the updater finished an item that waited in later with 'Agora preciso ver como ...'.",
		request: {
			state: timeline("Resolver problemas do sistema de goal", [
				["g1", "done", "Fazer push do código"],
				["g2", "done", "Pesquisar implementações de recap/goal/todo list para agentes"],
				["g3", "later", "Comparar o que o goal publica com os 3 casos de uso"],
			]),
			trigger: "work",
			asked:
				"ok, vamos la! vamos melhorar, mas NAO IREMOS COMMITAR ISSO DE PRIOR ART, a ideia era so pra gente se basear",
			news: [
				"call: read /home/adeildo/Projects/pi-harness/packages/goal/eval/run.ts",
				"said: Agora preciso ver como o trabalho chega ao modelo: que sinal do runtime existe hoje em cada `call:`.",
				"call: read /home/adeildo/Projects/pi-harness/packages/goal/src/transcript.ts",
				"said: A ordem combinada começa por medir. Primeiro levanto quantas chamadas reais do goal já estão gravadas:",
				"call: bash bun packages/goal/eval/extract.ts > /tmp/goal-calls.jsonl",
			].join("\n"),
		},
		expect: { open: ["g3"], noNew: true },
	},
	{
		name: "words about other work do not close the step",
		why: "Mid-run, the updater finished 'Corrigir ascii de borda' with a line about ops.ts.",
		request: {
			state: timeline("Facilitar a classificação do goal", [
				["g1", "done", "Fazer push das mudanças"],
				["g2", "later", "Investigar erros na sessão atual"],
				["g3", "now", "Corrigir ascii de borda quebrado"],
			]),
			trigger: "work",
			asked:
				'outra coisa, a ordem em que o goal eh cadastrado, meio que define oq que eh "now" e o que que eh "later" e nao necessariamente a ordem esta certa... saca?',
			news: [
				"call: bash cd packages/goal/src; sed -n 25,48p transcript.ts",
				"call: bash cd packages/goal && python3 - <<'EOF'",
				"said: Agora o `ops.ts`: prova só depois de o item existir, e um passo por mensagem.",
				"call: bash cd packages/goal && sed -n 125,175p src/ops.ts",
			].join("\n"),
		},
		expect: { open: ["g3"] },
	},
	{
		name: "files written mid-run do not finish a large step",
		why: "Mid-run, the updater finished 'Validar hipóteses com análises' when two pages were written.",
		request: {
			state: timeline("Documentar a investigação com análises verificáveis", [
				["g1", "done", "Tirar os IDs dos títulos do research"],
				["g2", "now", "Validar hipóteses com análises de dados"],
			]),
			trigger: "work",
			asked:
				"ou seja, ter uns graficos que mostram umas correlacoes eh boa... tipo: requests para .md antes do rebuild e DEPOIS do rebuild. oq foi isso?",
			news: [
				"call: bash cd ~/Projects/research && sed -i \"s/^select date_trunc('day', created_at)::date as day,/select date…",
				"call: write /home/adeildo/Projects/research/docs/achados/a05-crawlers-leem-o-md.md",
				"call: write /home/adeildo/Projects/research/docs/achados/a04-robos-nao-mandam-query-string.md",
			].join("\n"),
		},
		expect: { open: ["g2"], now: "g2" },
	},
	{
		name: "a call for something else does not close the step",
		why: "The updater finished 'Limpar e reorganizar a timeline' on a release merge call.",
		request: {
			state: timeline("Deixar o pi-goal pronto para usar", [
				["g1", "done", "Mostrar o goal na faixa de cima"],
				["g2", "later", "Adicionar a visualização da sessão (Alt+G)"],
				["g3", "now", "Limpar e reorganizar a timeline com clareza"],
			]),
			trigger: "work",
			asked:
				'e pq caralhos ainda estamos presos nesse "desenvolver a extensao goal do pi-harness" sempre sempre sempre?',
			news: "call: bash gh pr merge 28 --squash 2>&1 | tail -1; sleep 15; gh run list --workflow release.yml",
		},
		expect: { open: ["g3"] },
	},
	{
		name: "a confident close over a failed call is not done",
		why: "Agents claim success over failures, and a confident line fools a reader of the transcript.",
		request: {
			state: timeline("Publicar o 5.6.0", [
				["g1", "done", "Fazer commit das mudanças"],
				["g2", "now", "Fazer push das mudanças"],
			]),
			trigger: "work",
			final: true,
			asked: "ok vamos fazer push",
			news: [
				`call: bash git push origin main 2>&1 | tail -25 ${FAILED}`,
				"said: Push feito, está tudo no GitHub e o verify passou.",
			].join("\n"),
		},
		expect: { open: ["g2"], now: "g2" },
	},
	{
		name: "a push that came back is done, and the agent moves on",
		why: "Must keep working: the push finished, then the agent answered what comes next.",
		request: {
			state: timeline(undefined, [["g1", "now", "Fazer push do código"]]),
			trigger: "work",
			final: true,
			asked:
				"vamos fazer push e ir para o proximo passo, oq mais precisamos implementar / corrigir?",
			news: [
				"call: bash git status --short && git log --oneline origin/main..HEAD",
				"said: Árvore limpa, 3 commits locais. Fazendo push (o pre-push roda o verify):",
				"call: bash git push origin main 2>&1 | tail -25",
				"said: Push feito (`4e89852..632cbcc`, verify 792 verdes). Agora o que falta:",
				"call: read /home/adeildo/Projects/pi-harness/ROADMAP.md",
				"call: bash gh issue list --limit 30; gh pr list",
				"said: Feito o push: `4e89852..632cbcc` em `main`. O verify passou com 792 testes. Também tem a PR #29 aberta. ## O que falta, por prioridade ... Quer que eu comece pelo goal?",
			].join("\n"),
		},
		expect: { done: ["g1"], noNew: true },
	},
	{
		name: "a run that did part of the step says what it left out",
		why: "Must keep working: the skills ran, the reviewers did not, and that is what the step left out.",
		request: {
			state: timeline("Facilitar a classificação do goal", [
				["g1", "done", "Fazer push das mudanças"],
				["g2", "now", "Rodar simplify, code-review e unslop nas mudanças"],
			]),
			trigger: "work",
			final: true,
			asked: "/skill:simplify  e /skill:code-review  e /skill:unslop",
			news: [
				"call: bash git diff --stat",
				"call: edit packages/goal/src/ops.ts",
				`call: subagent {"agent":"reviewer"} ${FAILED}`,
				"call: bash bun run verify",
				"said: Rodei simplify, code-review e unslop. O `bun run verify` passa (786 testes). Ainda não fiz commit. Os revisores separados não rodaram: a ferramenta de subagentes usou a conta ranqia, que estava no limite.",
			].join("\n"),
		},
		expect: { done: ["g2"], noNew: true, mentions: /revis|review|subagent/i },
	},
	{
		name: "a commit the step left is not a new item",
		why: "The agent cleaned the comments and said nothing was committed; the updater closed the step and also added 'Fazer commit da limpeza'.",
		request: {
			state: timeline("Resolver problemas do sistema de goal", [
				["g1", "done", "Verificar por que a sessão deepseek não gerou nada"],
				["g2", "now", "Remover comentários desnecessários do código"],
			]),
			trigger: "work",
			final: true,
			asked:
				"tem muito comentario de merda... as vezes mais comentario do que codigo... acho que poderiamos remover um monte deles",
			news: [
				"call: bash grep -nE '^\\s*(//|/\\*\\*)' src/ops.ts src/updates.ts",
				"call: bash python3 - <<'PYEOF'",
				"call: bash bun run verify",
				"call: bash bun run goal:eval --runs 5",
				"said: Ficou mais limpo, e a eval se manteve: **166/180 (92%)**. O verify passou com 795 testes. **Nada commitado ainda.** Faço os três commits?",
			].join("\n"),
		},
		expect: { done: ["g2"], noNew: true, mentions: /commit/i },
	},
	{
		name: "in English: moving on is not done",
		why: "The same case in English, so the rules do not lean on Portuguese words.",
		request: {
			state: timeline(
				"Ship release 5.6.0",
				[["g1", "now", "Merge the 5.6.0 release PR"]],
				"English",
			),
			trigger: "message",
			news: "let's update the roadmap",
		},
		expect: { open: ["g1"], now: /roadmap/i },
	},
	{
		name: "in English: a question finishes nothing",
		why: "The same case in English, so the rules do not lean on Portuguese words.",
		request: {
			state: timeline(
				"Get pi-goal ready to use",
				[
					["g1", "done", "Show the goal on the top strip"],
					["g2", "later", "Publish the pi-goal placeholder to npm", "needs 2FA"],
					["g3", "now", "Merge the release PR and watch the workflow"],
				],
				"English",
			),
			trigger: "message",
			news: "it showed up already...\n\ntell me something, are we passing the intent to the judge yet?",
		},
		expect: { open: ["g2", "g3"], noNew: true },
	},
	{
		name: "in English: work that finished is done",
		why: "The same case in English, so the rules do not lean on Portuguese words.",
		request: {
			state: timeline(
				"Get pi-goal ready to use",
				[
					["g1", "done", "Show the goal on the top strip"],
					["g2", "now", "Round the corners of the Alt+G window"],
				],
				"English",
			),
			trigger: "work",
			final: true,
			asked: "that Alt+G window could have round corners too, you know?",
			news: [
				"call: edit packages/goal/src/view.ts",
				"call: bash bun run verify",
				"said: The window corners are rounded now (╭╮╰╯), and verify passes (776 tests).",
				"call: bash git commit -qm 'fix(goal): round the Alt+G panel corners' && git push",
				"said: Done, `1566bf6` is on GitHub.",
			].join("\n"),
		},
		expect: { done: ["g2"], noNew: true },
	},
	{
		name: "tidy: a repeat in another language is the same work",
		why: "Items that say the same work in two languages are one.",
		request: {
			trigger: "tidy",
			state: timeline(
				"Get pi-goal ready to use",
				[
					["g1", "done", "Arredondar os cantos da janela do Alt+G"],
					["g2", "later", "Round the corners of the Alt+G window"],
					["g3", "later", "Frame the operator's message"],
				],
				"English",
			),
			session: [
				"operator: that Alt+G window could have round corners too",
				"said: The window corners are rounded now, and verify passes.",
			].join("\n"),
		},
		expect: { done: ["g2"], open: ["g3"] },
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
		name: "tidy: the ask that put an item off does not finish it",
		why: "The tidy pass finished a deferred item with the operator's words that deferred it.",
		request: {
			trigger: "tidy",
			state: writtenAt(
				timeline("Facilitar a classificação do goal", [
					["g1", "done", "Rodar simplify e code-review nas mudanças"],
					[
						"g2",
						"later",
						"Implementar solução built-in para contas de subagents",
						"resolver quando houver solução própria",
					],
				]),
				2,
			),
			session: [
				{
					text: "operator: acho que as contas de subagents estao usando a conta default... acho que precisamos salvar esse problema pra resolver depois, mas como trata-se de uma extensao de terceiros... talvez valha so implementar isso dai quando a gente fizer nossa propria solucao built-in.... oq achas?",
					at: 1,
				},
				{
					text: "said: Anotei no scratchpad. Concordo em deixar para o nosso subagents built-in, que já está no roadmap.",
					at: 3,
				},
			],
		},
		expect: { open: ["g2"] },
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
