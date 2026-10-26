// npm asks for 2FA only when it owns a terminal, so commands that may ask get it.
export async function interactive(command: readonly string[]): Promise<number> {
	const child = Bun.spawn([...command], { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
	return await child.exited;
}
