// The page the daemon serves. One build, hashed assets, no server rendering: the daemon answers the
// same `index.html` for every route of the page, and the browser draws it.
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [react()],
	build: { outDir: "dist", emptyOutDir: true, target: "es2023" },
});
