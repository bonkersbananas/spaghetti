import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import type { Icon } from "./icons";

/**
 * The class of one quiet line that leads somewhere: `text-small`, 44 px tall, a faint wash on hover. Put it on a
 * router `Link` with a `QuietRowContent` inside (the Link keeps its own typed `to` and `params`).
 */
export const quietRowClass =
  "focus-ring pressable text-small text-ink-soft hover:text-ink duration-fast hover:bg-ink/4 -mx-2 flex min-h-11 items-start gap-2 rounded-md px-2 py-2.5 transition-colors";

interface QuietRowContentProps {
  icon: Icon;
  /** The icon's own color: faint by default, tomato for what someone wrote to you. */
  iconClassName?: string;
  children: ReactNode;
}

/** A small icon and the words beside it. The small lines of Today (what the printer needs, what the other person wrote) share this. */
export function QuietRowContent({ icon: IconComponent, iconClassName, children }: QuietRowContentProps) {
  return (
    <>
      <IconComponent size={16} className={cn("mt-0.5 shrink-0", iconClassName ?? "text-ink-faint")} aria-hidden />
      <span className="min-w-0">{children}</span>
    </>
  );
}
