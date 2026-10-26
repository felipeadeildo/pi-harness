// `bun run build` writes the page to `dist/web`; the daemon answers `index.html` for every route.
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [react(), tailwindcss()],
	resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
	build: { target: "es2023" },
});
