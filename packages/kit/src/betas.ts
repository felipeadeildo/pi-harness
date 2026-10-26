// Pi drops its own beta list once an extension sets the header, so features add to the payload's
// list instead. A payload that needed nothing comes back as the same object.

export interface Betas {
	betas: string[];
	added: boolean;
}

export function mergeBetas(existing: unknown, wanted: readonly string[]): Betas {
	const betas = Array.isArray(existing) ? existing.filter(isString) : [];
	let added = false;
	for (const beta of wanted) {
		if (betas.includes(beta)) continue;
		betas.push(beta);
		added = true;
	}
	return { betas, added };
}

function isString(value: unknown): value is string {
	return typeof value === "string";
}
