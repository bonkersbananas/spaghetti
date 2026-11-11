import { m, useReducedMotion } from "motion/react";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { spring } from "@/lib/motion";

/**
 * Grows or shrinks smoothly to fit what it holds, as a real height (no scaling), clipping only while it moves:
 * a card that changes shape in place, such as a compact print card becoming Today's big one. The first height is
 * set at once, and with reduced motion every change is (MotionConfig only stops transforms, not heights).
 */
export function AutoHeight({ children, className }: { children: ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  const inner = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | "auto">("auto");
  useLayoutEffect(() => {
    const element = inner.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setHeight(element.offsetHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <m.div
      initial={false}
      animate={{ height, overflow: "hidden", transitionEnd: { overflow: "visible" } }}
      transition={reduce ? { duration: 0 } : spring.gentle}
      className={className}
    >
      <div ref={inner}>{children}</div>
    </m.div>
  );
}
