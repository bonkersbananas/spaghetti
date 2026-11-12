import type { ErrorComponentProps } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

// Its own chunk: the designed screen costs no first-load bytes. If that chunk is gone (an old build), Vite's
// preload error reloads the app (lib/stale-build.ts).
const ErrorScreen = lazy(() => import("@/components/ui/ErrorScreen"));

/** The router's default error screen, and the root's. */
export const RouterError = ({ error, reset }: ErrorComponentProps) => (
  <Suspense fallback={null}>
    <ErrorScreen error={error} reset={reset} />
  </Suspense>
);
