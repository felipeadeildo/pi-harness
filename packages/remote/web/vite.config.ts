// `bun run build` writes the page to `dist/web`; the daemon answers `index.html` for every route.
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [react()],
	build: { target: "es2023" },
});
