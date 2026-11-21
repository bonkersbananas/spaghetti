import { useIsDesktop, useMediaQuery } from "./use-media-query";

/**
 * Whether to offer the camera: any layout narrower than the desktop one, and any touch screen however wide (an iPhone
 * held sideways is 844+ px wide, an iPad 768+, and neither has a mouse: `capture` opens their camera). A desktop with a
 * mouse has no camera to open.
 */
export function useHasCamera(): boolean {
  const isDesktop = useIsDesktop();
  const touch = useMediaQuery("(pointer: coarse)");
  return !isDesktop || touch;
}
