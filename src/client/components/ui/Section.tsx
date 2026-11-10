import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Overline } from "./Overline";
import { SectionHeading } from "./SectionHeading";

interface SectionProps {
  /** The heading's id, which names the section for screen readers. */
  id: string;
  title: ReactNode;
  /**
   * `headline`: a page's main sections ("Up next", "Upkeep", "Running low"). `title`: quieter groups under them
   * ("Done", a material, "What used it"). `overline`: the small caption over a block on a dense page (Today).
   */
  size?: "headline" | "title" | "overline";
  /** How many things it holds, after the title: "Up next 2". */
  count?: number;
  /** On the heading's right, on its baseline: a hint, a link, a small action or a figure. */
  aside?: ReactNode;
  /** The heading level; h2 unless the section sits inside another. */
  as?: "h2" | "h3";
  className?: string;
  children: ReactNode;
}

/**
 * A section of a page: its heading (with a count and an aside when there are) and what it holds, at one distance
 * under the heading for each size, so sections built on different screens line up the same way.
 */
export function Section({ id, title, size = "headline", count, aside, as = "h2", className, children }: SectionProps) {
  const heading =
    size === "overline" ? (
      <Overline as={as} id={id} count={count}>
        {title}
      </Overline>
    ) : (
      <SectionHeading as={as} id={id} size={size} count={count}>
        {title}
      </SectionHeading>
    );
  return (
    <section
      aria-labelledby={id}
      className={cn("flex flex-col", size === "overline" ? "gap-3" : "gap-4 md:gap-5", className)}
    >
      {aside ? (
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          {heading}
          <div className="flex shrink-0 items-baseline">{aside}</div>
        </div>
      ) : (
        heading
      )}
      {children}
    </section>
  );
}
