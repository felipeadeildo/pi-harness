// The page the daemon serves. One build, hashed assets, no server rendering: the daemon answers the
// same `index.html` for every route of the page, and the browser draws it. `bun run build` in the
// package writes it to `dist/web`, next to the daemon.
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [react()],
	build: { target: "es2023" },
});
