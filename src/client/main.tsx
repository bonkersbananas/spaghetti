import "@fontsource-variable/fraunces/full.css";
import "@fontsource-variable/figtree";
import "./styles/app.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerServiceWorker } from "./lib/offline";
import { initTheme } from "./lib/theme";
import { routeTree } from "./routeTree.gen";

const queryClient = new QueryClient({
  defaultOptions: {
    // "always": without a connection a query fails at once and the screen can say so,
    // rather than waiting forever behind a skeleton.
    queries: { staleTime: 30_000, refetchOnWindowFocus: true, retry: 1, networkMode: "always" },
  },
});

const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: "intent",
  defaultPreloadStaleTime: 0,
  scrollRestoration: true,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

initTheme();
registerServiceWorker();

const root = document.getElementById("root");
if (!root) throw new Error("#root is missing from index.html");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
