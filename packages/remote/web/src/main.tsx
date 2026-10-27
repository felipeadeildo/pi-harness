// The daemon serves `index.html` for every path the page owns.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";

import { Pick, Sessions, Shell } from "./app/shell.tsx";

import "./app.css";

const router = createBrowserRouter([
	{
		path: "/",
		element: <Shell />,
		children: [
			{
				element: <Sessions />,
				children: [
					{ index: true, element: <Pick /> },
					{ path: "session/:machine/:id", lazy: () => import("./app/session.tsx") },
				],
			},
			{ path: "machines", lazy: () => import("./app/machines.tsx") },
		],
	},
]);

// A page left open across a new build asks for chunks the build removed; the new page has them.
window.addEventListener("vite:preloadError", (event) => {
	const last = Number(sessionStorage.getItem("reloaded-for-build") ?? 0);
	if (Date.now() - last < 10_000) return;
	event.preventDefault();
	sessionStorage.setItem("reloaded-for-build", String(Date.now()));
	// A tap into a session has not moved the address yet while its chunk loads.
	const going = router.state.navigation.location;
	if (going === undefined) location.reload();
	else location.assign(`${going.pathname}${going.search}${going.hash}`);
});

createRoot(document.getElementById("root") as HTMLElement).render(
	<StrictMode>
		<RouterProvider router={router} />
	</StrictMode>,
);
