// npm asks for 2FA only when it owns a terminal. Bun's `$` gives a command no stdin, so npm reads
// that as a script and fails with EOTP instead of opening the browser. Commands that may ask go
// through here, with the terminal handed over.
export async function interactive(command: readonly string[]): Promise<number> {
	const child = Bun.spawn([...command], { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
	return await child.exited;
}
