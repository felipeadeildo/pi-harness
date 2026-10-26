// The daemon serves `index.html` for every path the page owns.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";

import { Pick, Shell } from "./app/shell.tsx";

import "./app.css";

const router = createBrowserRouter([
	{
		path: "/",
		element: <Shell />,
		children: [
			{ index: true, element: <Pick /> },
			{ path: "session/:machine/:id", lazy: () => import("./app/session.tsx") },
		],
	},
]);

createRoot(document.getElementById("root") as HTMLElement).render(
	<StrictMode>
		<RouterProvider router={router} />
	</StrictMode>,
);
