import "@fontsource-variable/figtree";
import "./styles/app.css";

import { QueryCache, QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerServiceWorker } from "./lib/offline";
import { MAX_AGE, persistOptions, recordFetch, refetchRestored } from "./lib/persist";
import { RouterError } from "./lib/router-error";
import { initTheme } from "./lib/theme";
import { trackVisibleViewport } from "./lib/viewport";
import { warmPhotosFor } from "./lib/warm-photos";
import { routeTree } from "./routeTree.gen";

const queryClient = new QueryClient({
  // Only answers from the server date what was seen (optimistic edits don't).
  queryCache: new QueryCache({
    onSuccess: (data, query) => {
      recordFetch(query);
      warmPhotosFor(query.queryKey, data);
    },
  }),
  defaultOptions: {
    // "always": without a connection a query fails at once and the screen can say so,
    // rather than waiting forever behind a skeleton.
    // gcTime: what is saved to the device must outlive the five-minute default, or it is dropped from the copy too.
    queries: { staleTime: 30_000, refetchOnWindowFocus: true, retry: 1, networkMode: "always", gcTime: MAX_AGE },
  },
});

const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: "intent",
  defaultPreloadStaleTime: 0,
  scrollRestoration: true,
  defaultErrorComponent: RouterError,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

// A chunk of this build is gone (a deploy): the app takes the new version once (lib/stale-build.ts, loaded only now).
// The error still reaches the router's error screen, which does the same (and says what is happening).
addEventListener("vite:preloadError", () => void import("./lib/stale-build").then((m) => m.reloadIntoNewBuild()));
initTheme();
trackVisibleViewport();
registerServiceWorker();

const root = document.getElementById("root");
if (!root) throw new Error("#root is missing from index.html");

createRoot(root).render(
  <StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={persistOptions}
      // What was kept is shown at once, but the network always has the first word.
      onSuccess={() => refetchRestored(queryClient)}
    >
      <RouterProvider router={router} />
    </PersistQueryClientProvider>
  </StrictMode>,
);
