// Where a session runs and what it has spent: the wide screen's right column, a panel on a phone.
import type { ClientSession } from "@adeildo/pi-remote-protocol/client";
import {
	ChipIcon,
	ComputerIcon,
	Folder01Icon,
	GitBranchIcon,
	Money03Icon,
	SecurityCheckIcon,
	UserMultipleIcon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import type { ReactNode } from "react";

import { Progress } from "@/components/ui/progress";
import { contextShare, money, shortPath, tokens } from "@/session/format.ts";

import { Icon } from "./kit.tsx";

export function Details({ session }: { session: ClientSession }): ReactNode {
	const { state, summary } = session;
	const share = contextShare(summary?.context);
	const cost = state.cost;
	const viewers = session.presence?.viewers ?? [];
	return (
		<dl className="flex flex-col gap-4 text-sm">
			<Fact icon={Folder01Icon} label="Folder">
				<span className="font-mono text-[12.5px] break-all">
					{summary === undefined ? "…" : shortPath(summary.cwd)}
				</span>
			</Fact>
			{state.branch === undefined ? null : (
				<Fact icon={GitBranchIcon} label="Branch">
					<span className="font-mono text-[12.5px] break-all">{state.branch}</span>
				</Fact>
			)}
			<Fact icon={ComputerIcon} label="Machine">
				{session.key.machine}
			</Fact>
			<Fact icon={ChipIcon} label="Model">
				<span className="font-mono text-[12.5px] break-all">
					{state.model === undefined ? "…" : `${state.model.provider}/${state.model.id}`}
				</span>
				{state.thinkingLevel === undefined ? null : (
					<span className="text-muted-foreground"> · thinking {state.thinkingLevel}</span>
				)}
			</Fact>
			{state.permissions.mode === undefined ? null : (
				<Fact icon={SecurityCheckIcon} label="Permission mode">
					<span className="font-mono text-[12.5px]">{state.permissions.mode}</span>
				</Fact>
			)}
			{share === undefined || summary?.context === undefined ? null : (
				<div className="flex flex-col gap-1.5">
					<dt className="flex items-center justify-between text-xs text-muted-foreground">
						<span>Context</span>
						<span className="tabular font-mono">
							{Math.round(share * 100)}% · {tokens(summary.context.tokens)} of{" "}
							{tokens(summary.context.window ?? 0)}
						</span>
					</dt>
					<dd>
						<Progress value={Math.round(share * 100)} aria-label="Context used" />
					</dd>
				</div>
			)}
			{cost === undefined ? null : (
				<Fact icon={Money03Icon} label="Spent">
					<span className="tabular font-mono text-[12.5px]">{money(cost.total)}</span>
					<span className="block text-xs text-muted-foreground">
						in {tokens(cost.input)} · out {tokens(cost.output)} · cache read{" "}
						{tokens(cost.cacheRead)}
					</span>
				</Fact>
			)}
			{viewers.length === 0 ? null : (
				<Fact icon={UserMultipleIcon} label="Watching">
					{viewers.map((one) => `${one.name} on ${one.machine}`).join(", ")}
				</Fact>
			)}
		</dl>
	);
}

function Fact({
	icon,
	label,
	children,
}: {
	icon: IconSvgElement;
	label: string;
	children: ReactNode;
}): ReactNode {
	return (
		<div className="flex gap-2.5">
			<Icon icon={icon} className="mt-0.5 size-4 text-dim" />
			<div className="min-w-0 flex-1">
				<dt className="text-xs text-muted-foreground">{label}</dt>
				<dd className="mt-0.5">{children}</dd>
			</div>
		</div>
	);
}
