import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import type { Icon } from "./icons";

interface InfoRowProps {
  icon: Icon;
  /** What it is: "Kitchen iPad", "iPhone". */
  title: ReactNode;
  /** A quiet second line: when it was added, last used. */
  meta?: ReactNode;
  /** Buttons at the end of the row (rename, remove, sign out). */
  actions?: ReactNode;
  className?: string;
}

/**
 * One thing you own, in a list inside a sheet: a passkey, a signed-in device, a waiting invite. A soft icon tile,
 * a name, a quiet line under it and the actions at the end. Rows sit in a plain `ul` with a hairline between them.
 */
export function InfoRow({ icon: IconComponent, title, meta, actions, className }: InfoRowProps) {
  return (
    <li className={cn("not-first:border-hairline flex min-h-16 items-center gap-3 py-2 not-first:border-t", className)}>
      <span className="bg-paper text-ink-soft grid size-10 shrink-0 place-items-center rounded-full">
        <IconComponent size={20} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="text-body text-ink block truncate font-semibold">{title}</span>
        {meta && <span className="text-small text-ink-faint block">{meta}</span>}
      </span>
      {actions && <span className="flex shrink-0 items-center gap-0.5">{actions}</span>}
    </li>
  );
}
