import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import { MotionConfig } from "motion/react";
import { IconContext } from "@/components/ui/icons";
import { Toaster } from "@/components/ui/Toast";

export interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: Root,
});

function Root() {
  return (
    <MotionConfig reducedMotion="user">
      <IconContext value={{ size: 20, weight: "regular" }}>
        <Outlet />
        <Toaster />
      </IconContext>
    </MotionConfig>
  );
}
