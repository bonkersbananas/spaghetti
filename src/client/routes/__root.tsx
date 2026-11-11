import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import { LazyMotion, MotionConfig } from "motion/react";
import { useState } from "react";
import { IconContext } from "@/components/ui/icons";
import { Toaster } from "@/components/ui/Toast";
import { useWhenIdle } from "@/lib/when-idle";

const loadMotionFeatures = () => import("@/lib/motion-features").then((module) => module.default);
const loadMotionMax = () => import("@/lib/motion-max").then((module) => module.default);

/**
 * Layout animations and drag, once the app is idle. A second LazyMotion registers the features for the whole app
 * (they are global; components pick them up on their next render), so nothing waits for them and cards that arrive
 * later still glide into place.
 */
function MotionMax() {
  const [ready, setReady] = useState(false);
  useWhenIdle(() => setReady(true));
  return ready ? <LazyMotion features={loadMotionMax}>{null}</LazyMotion> : null;
}

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
          <MotionMax />
          <Toaster />
        </IconContext>
      </LazyMotion>
    </MotionConfig>
  );
}
