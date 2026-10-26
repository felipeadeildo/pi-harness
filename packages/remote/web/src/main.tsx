// The page: two routes, drawn in the browser. Everything the daemon serves for a path the page owns is
// this file's `index.html`, and the router reads the address from there.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";

import "./app.css";

const router = createBrowserRouter([{ path: "/", lazy: () => import("./pages/sessions.tsx") }]);

createRoot(document.getElementById("root") as HTMLElement).render(
	<StrictMode>
		<RouterProvider router={router} />
	</StrictMode>,
);
