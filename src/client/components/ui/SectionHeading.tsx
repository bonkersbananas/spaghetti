import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

interface SectionHeadingProps {
  /** How many things the section holds, after the title in small figures: "Attempts 3". */
  count?: number;
  /** "headline" for a page's main sections, "title" for quieter groups (done builds, a material in the pantry). */
  size?: "headline" | "title";
  /** The heading level: h2, or h3 for a group inside a section. */
  as?: "h2" | "h3";
  id?: string;
  className?: string;
  children: ReactNode;
}

/**
 * A section's title in Fraunces, with an optional count beside it. The count
 * is separated by a real space, so a screen reader says "Attempts 3", not
 * "Attempts3".
 */
export function SectionHeading({
  count,
  size = "headline",
  as: Tag = "h2",
  id,
  className,
  children,
}: SectionHeadingProps) {
  return (
    <Tag id={id} className={cn(size === "headline" ? "text-headline text-ink" : "text-title text-ink-soft", className)}>
      {children}
      {count !== undefined && (
        <>
          {" "}
          <span className="text-small text-ink-faint tabular ml-0.5 align-middle font-sans font-semibold">{count}</span>
        </>
      )}
    </Tag>
  );
}
