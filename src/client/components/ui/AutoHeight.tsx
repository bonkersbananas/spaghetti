import { m, useReducedMotion } from "motion/react";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { spring } from "@/lib/motion";

interface AutoHeightProps {
  /**
   * What changes the content's shape on purpose (Today: whether the card is compact). Only that change animates;
   * at rest the box is plain `height: auto`, so heights that settle as a page loads (photos, fonts) never move it.
   */
  trigger: unknown;
  className?: string;
  children: ReactNode;
}

/**
 * Grows or shrinks smoothly to fit what it holds when `trigger` changes, as a real height (no scaling), clipped only
 * while it moves: a card that changes shape in place, such as a compact print card becoming Today's big one. It
 * holds the old height, measures the new content and springs to it, then lets go. With reduced motion it doesn't
 * animate (MotionConfig stops transforms, not heights).
 */
export function AutoHeight({ trigger, className, children }: AutoHeightProps) {
  const reduce = useReducedMotion();
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const lastTrigger = useRef(trigger);
  // The height it had when the trigger changed (held while the new content is measured), and where it is going.
  const [from, setFrom] = useState<number | null>(null);
  const [to, setTo] = useState<number | null>(null);

  if (lastTrigger.current !== trigger) {
    lastTrigger.current = trigger;
    const height = outer.current?.offsetHeight;
    if (!reduce && height) {
      setFrom(height);
      setTo(null);
    }
  }

  useLayoutEffect(() => {
    if (from === null || !inner.current) return;
    setTo(inner.current.offsetHeight);
  }, [from]);

  const moving = from !== null;
  return (
    <m.div
      ref={outer}
      initial={false}
      style={moving ? { overflow: "hidden" } : { height: "auto" }}
      animate={moving ? { height: to ?? from } : undefined}
      transition={to === null ? { duration: 0 } : spring.gentle}
      onAnimationComplete={() => {
        if (to !== null) {
          setFrom(null);
          setTo(null);
        }
      }}
      className={className}
    >
      <div ref={inner}>{children}</div>
    </m.div>
  );
}
