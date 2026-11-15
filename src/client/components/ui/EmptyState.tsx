import { m } from "motion/react";
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
  /**
   * How much room it takes: `page` when it is all a screen has (the default),
   * `inline` when it sits in one section among others, `none` when the caller
   * draws its own box (padding and all) around it.
   */
  size?: "page" | "inline" | "none";
  className?: string;
}

const sizes = { page: "py-10 md:py-20", inline: "py-6 md:py-12", none: "" } as const;

/**
 * What a section shows before it has anything in it. A small pasta joke in
 * the title is welcome; the body says plainly what goes here and how.
 */
export function EmptyState({ illustration, title, children, action, size = "page", className }: EmptyStateProps) {
  return (
    <m.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: duration.slow, ease: ease.out }}
      // Sits in the page's content column (like the header and fields above
      // it) and centers within that column, not across the whole main area.
      className={cn("max-w-content flex w-full flex-col items-center text-center", sizes[size], className)}
    >
      <div className="mb-5">{illustration}</div>
      <h2 className="text-headline text-ink max-w-sm px-4">{title}</h2>
      {children && <div className="text-body text-ink-soft mt-2 max-w-sm px-4">{children}</div>}
      {action && <div className="mt-6">{action}</div>}
    </m.div>
  );
}
