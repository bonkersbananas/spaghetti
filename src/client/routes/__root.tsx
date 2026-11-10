import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import { LazyMotion, MotionConfig } from "motion/react";
import { IconContext } from "@/components/ui/icons";
import { Toaster } from "@/components/ui/Toast";

const loadMotionFeatures = () => import("@/lib/motion-features").then((module) => module.default);

export interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: Root,
});

function Root() {
  return (
    <MotionConfig reducedMotion="user">
      {/* Components use `m.*`; the animation code arrives just after the first screen. */}
      <LazyMotion features={loadMotionFeatures}>
        <IconContext value={{ size: 20, weight: "regular" }}>
          <Outlet />
          <Toaster />
        </IconContext>
      </LazyMotion>
    </MotionConfig>
  );
}
