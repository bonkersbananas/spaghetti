import { AnimatePresence, m } from "motion/react";
import { type ReactNode, useId } from "react";
import { cn } from "@/lib/cn";
import { duration, ease } from "@/lib/motion";
import { ExpandIcon, type Icon } from "./icons";

interface DisclosureProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** One line on what's inside while it's closed: "PLA · 0.20 mm · bed 60 °C". */
  summary?: ReactNode;
  icon?: Icon;
  children: ReactNode;
  className?: string;
}

/**
 * Optional detail tucked away behind one tap, such as an attempt's print
 * settings: a quiet row with a summary that opens in place.
 */
export function Disclosure({
  open,
  onOpenChange,
  title,
  summary,
  icon: IconComponent,
  children,
  className,
}: DisclosureProps) {
  const id = useId();
  return (
    <div className={cn("bg-ink/3 rounded-lg", className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => onOpenChange(!open)}
        className="pressable focus-ring flex min-h-14 w-full items-center gap-3 rounded-lg px-4 py-3 text-left"
      >
        {IconComponent && <IconComponent size={20} className="text-ink-faint shrink-0" aria-hidden />}
        <span className="min-w-0 flex-1">
          <span className="text-body text-ink block font-semibold">{title}</span>
          {summary && !open && <span className="text-small text-ink-faint mt-0.5 line-clamp-2 block">{summary}</span>}
        </span>
        <ExpandIcon
          size={18}
          weight="bold"
          className={cn("text-ink-faint duration-base shrink-0 transition-transform ease-out", open && "rotate-180")}
          aria-hidden
        />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <m.div
            id={id}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: duration.base, ease: ease.out }}
            className="overflow-hidden"
          >
            <div className="px-4 pt-1 pb-4">{children}</div>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}
