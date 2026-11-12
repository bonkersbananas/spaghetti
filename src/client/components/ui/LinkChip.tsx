import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { ExternalIcon, type Icon } from "./icons";

/** The same pill as a Chip (kept apart so screens without one don't load it). */
const base = "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-pill px-2.5 text-small font-semibold md:h-6";

interface LinkChipProps {
  href: string;
  icon?: Icon;
  children: ReactNode;
  /** Leave the small arrow out on phones, where a row of two chips needs the room (still opens a new tab; screen readers are told). */
  quietArrow?: boolean;
  className?: string;
}

/**
 * A small link that leaves the app, as a chip: the shop a thing is sold in, its Prisjakt page. A quiet neutral pill
 * with a small arrow, opened in a new tab; `touch-target` gives it a 44 px hit area on phones.
 */
export function LinkChip({ href, icon: IconComponent, children, quietArrow, className }: LinkChipProps) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className={cn(
        base,
        "bg-ink/6 text-ink-soft hover:text-ink hover:bg-ink/10 pressable focus-ring touch-target duration-fast relative max-w-full min-w-0 transition-colors",
        className,
      )}
    >
      {IconComponent && <IconComponent size={14} weight="bold" aria-hidden />}
      <span className="truncate">{children}</span>
      <ExternalIcon
        size={12}
        weight="bold"
        className={cn("shrink-0 opacity-70", quietArrow && "max-md:hidden")}
        aria-hidden
      />
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}
