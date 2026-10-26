// One icon per tool, the same in the transcript, the list and the status line.
import {
	ComputerTerminal01Icon,
	File01Icon,
	FileAddIcon,
	FileEditIcon,
	FolderOpenIcon,
	Globe02Icon,
	HelpCircleIcon,
	KanbanIcon,
	Search01Icon,
	SourceCodeIcon,
	UserGroupIcon,
	Wrench01Icon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";

const ICONS: Record<string, IconSvgElement> = {
	bash: ComputerTerminal01Icon,
	read: File01Icon,
	edit: FileEditIcon,
	write: FileAddIcon,
	grep: Search01Icon,
	find: Search01Icon,
	ls: FolderOpenIcon,
	codemode: SourceCodeIcon,
	ask_questions: HelpCircleIcon,
	web_search: Globe02Icon,
	fetch_content: Globe02Icon,
	source_check: Globe02Icon,
	peers: UserGroupIcon,
	board: KanbanIcon,
};

export function toolIcon(name: string): IconSvgElement {
	return ICONS[name] ?? Wrench01Icon;
}
