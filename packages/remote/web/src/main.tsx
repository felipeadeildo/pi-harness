// Two routes. The daemon serves `index.html` for every path the page owns.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";

import "./app.css";

const router = createBrowserRouter([
	{ path: "/", lazy: () => import("./pages/sessions.tsx") },
	{ path: "/session/:machine/:id", lazy: () => import("./pages/session.tsx") },
]);

createRoot(document.getElementById("root") as HTMLElement).render(
	<StrictMode>
		<RouterProvider router={router} />
	</StrictMode>,
);
