// `bun run build` writes the page to `dist/web`; the daemon answers `index.html` for every route.
// `bun run dev` serves it with hot reload, and the daemon at PI_REMOTE_DAEMON answers the rest.
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type ProxyOptions } from "vite";

const daemon = process.env.PI_REMOTE_DAEMON ?? "http://127.0.0.1:7878";

/** The daemon checks Host and Origin, so the dev server's requests read as its own page's. */
function toDaemon(ws: boolean): ProxyOptions {
	return {
		target: daemon,
		changeOrigin: true,
		ws,
		configure(proxy) {
			proxy.on("proxyReq", (request) => request.setHeader("origin", daemon));
			proxy.on("proxyReqWs", (request) => request.setHeader("origin", daemon));
		},
	};
}

export default defineConfig({
	plugins: [react(), tailwindcss()],
	resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
	build: { target: "es2023" },
	server: {
		port: 5199,
		strictPort: true,
		proxy: {
			"^/ws(\\?|$)": toDaemon(true),
			"^/(health|login|logout|sessions|shared|rooms|\\.well-known)([/?]|$)": toDaemon(false),
		},
	},
});
