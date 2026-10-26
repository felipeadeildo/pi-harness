// The skills a prompt loaded: a chip per skill, which opens the text the agent read.
import { type ReactNode, useState } from "react";

import type { Skill } from "@/session/turns.ts";

import { Panel } from "./kit.tsx";
import { Markdown } from "./markdown.tsx";
import { SkillChip } from "./skill-chip.tsx";

export function SkillsLoaded({ skills }: { skills: readonly Skill[] }): ReactNode {
	const [open, setOpen] = useState<Skill | undefined>(undefined);
	const count = skills.length === 1 ? "a skill" : `${skills.length} skills`;
	return (
		<div className="ml-auto flex max-w-[88%] flex-col items-end gap-1.5">
			<p className="text-xs text-muted-foreground">Loaded {count} for this prompt</p>
			<div className="flex flex-wrap justify-end gap-1.5">
				{skills.map((skill, index) => (
					<SkillChip
						key={skill.name}
						name={skill.name}
						onPress={() => setOpen(skill)}
						className="px-2 py-1 text-[12.5px] motion-safe:animate-in motion-safe:fill-mode-both motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:slide-in-from-bottom-1"
						style={{ animationDelay: `${index * 60}ms` }}
					/>
				))}
			</div>
			<Panel
				open={open !== undefined}
				onOpenChange={(next) => (next ? undefined : setOpen(undefined))}
				title={open?.name ?? ""}
				description="What the agent read before your prompt"
			>
				<div className="px-4 pb-6 text-[13.5px]">
					{open === undefined ? null : <Markdown text={open.text} />}
				</div>
			</Panel>
		</div>
	);
}
