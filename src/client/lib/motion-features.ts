/**
 * The animation features <LazyMotion> loads after the first screen (layout
 * animations and drag included: cards that land, Reorder in the photo strip).
 * Kept in its own module so the first load carries only motion's small `m`.
 */
export { domMax as default } from "motion/react";
