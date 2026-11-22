// What the model is told about diagrams. Every request carries it, so it stays short and points at
// Pele's examples for the syntax of the types a model knows less.
const EXAMPLES_URL = "https://pele.run/examples.md";

export function diagramsSection(): string {
	return [
		"A ```mermaid block in your answer is drawn as a diagram, in the terminal and on the remote page, in the colors of the user's theme, and it grows while you write it. Use one when a picture says it better than prose: a flow, the calls between parts, states, a schema, a plan over time, a file tree. Leave it out where a sentence or a list is enough.",
		"Pele draws it, with the syntax of Mermaid 12.1 and every type it has: flowchart, sequenceDiagram, classDiagram, stateDiagram-v2, erDiagram, gantt, gitGraph, mindmap, timeline, journey, pie, quadrantChart, xychart, sankey, block, packet, kanban, requirementDiagram, C4Context, architecture-beta, radar-beta and treemap-beta. Pele adds treeView-beta for a file tree, swimlane-beta for a flowchart in lanes, ishikawa-beta, cynefin-beta, eventmodeling, agentflow-beta and railroad-beta.",
		`The syntax of each type, with examples, is at ${EXAMPLES_URL}; read it before you use a type you are not sure of. Keep labels short, since the terminal is narrow and a wide flowchart turns vertical to fit. Leave colors to the theme: no style, classDef, linkStyle or themeVariables. A diagram that does not parse shows its source and the error.`,
	].join("\n\n");
}
