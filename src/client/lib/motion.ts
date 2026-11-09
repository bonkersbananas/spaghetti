/**
 * Motion tokens for `motion` (the JS side of --sg-duration-* and --sg-ease-*
 * in tokens.css). <MotionConfig reducedMotion="user"> at the root turns
 * transforms off for people who prefer reduced motion.
 */
export const duration = { instant: 0.09, fast: 0.16, base: 0.24, slow: 0.42 } as const;
export const ease = {
  out: [0.22, 1, 0.36, 1],
  inOut: [0.65, 0, 0.35, 1],
} as const;
/** Springs for things that move under a finger: tabs, sheets, toggles. */
export const spring = {
  snappy: { type: "spring", stiffness: 520, damping: 34, mass: 0.8 },
  gentle: { type: "spring", stiffness: 260, damping: 28 },
} as const;
