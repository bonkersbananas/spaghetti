import { motion } from "motion/react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { duration, ease } from "@/lib/motion";

interface EmptyStateProps {
  /** A spot illustration from components/illustrations. */
  illustration: ReactNode;
  title: string;
  children?: ReactNode;
  /** One clear next step, usually a Button. */
  action?: ReactNode;
  className?: string;
}

/**
 * What a section shows before it has anything in it. A small pasta joke in
 * the title is welcome; the body says plainly what goes here and how.
 */
export function EmptyState({ illustration, title, children, action, className }: EmptyStateProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: duration.slow, ease: ease.out }}
      className={cn("mx-auto flex max-w-sm flex-col items-center px-6 text-center", className)}
    >
      <div className="mb-5">{illustration}</div>
      <h2 className="text-headline text-ink">{title}</h2>
      {children && <div className="text-body text-ink-soft mt-2">{children}</div>}
      {action && <div className="mt-6">{action}</div>}
    </motion.div>
  );
}
