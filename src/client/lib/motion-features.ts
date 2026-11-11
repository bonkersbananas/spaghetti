/**
 * The animation features <LazyMotion> loads, in two steps so the first load carries only what the first screen
 * needs: `domAnimation` (animate, exit, gestures: entrances, toasts, presses) right after the first render, and
 * `domMax` (layout animations and drag: cards that land, the photo strip's reorder) once the app is idle. Kept
 * apart from the components so the first load carries only motion's small `m`.
 */
export { domAnimation as default } from "motion/react";
