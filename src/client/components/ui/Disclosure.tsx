import { AnimatePresence, m } from "motion/react";
import { type ReactNode, useId } from "react";
import { cn } from "@/lib/cn";
import { duration, ease } from "@/lib/motion";
import { ExpandIcon, type Icon } from "./icons";

interface DisclosureProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Its name, or (a row that answers something, like a colour's spool) the row itself. */
  title: ReactNode;
  /** One line on what's inside while it's closed: "PLA · 0.20 mm · bed 60 °C". */
  summary?: ReactNode;
  icon?: Icon;
  /**
   * `well`: a quiet panel of its own (an attempt's settings on a card). `plain`: a row on the surface it is on, its
   * content in the surface's column, for a disclosure among other groups on a sheet or popover (a model's More), where
   * a panel would be a box inside a box.
   */
  appearance?: "well" | "plain";
  /** Under the row while it is closed, outside the button: chips to change one thing without opening it. */
  peek?: ReactNode;
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
  appearance = "well",
  peek,
  children,
  className,
}: DisclosureProps) {
  const id = useId();
  const plain = appearance === "plain";
  return (
    <div className={cn(!plain && "bg-ink/3 rounded-lg", className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => onOpenChange(!open)}
        className={cn(
          "pressable focus-ring flex min-h-14 gap-3 text-left",
          // Plain: its words in the column of the groups around it; the hover reaches past them, as a quiet button's.
          // Its glyphs keep to the title's line, however many lines the summary takes.
          plain
            ? "hover:bg-ink/4 -mx-3 w-[calc(100%+1.5rem)] items-start rounded-md px-3 py-2"
            : "w-full items-center rounded-lg px-4 py-3",
        )}
      >
        {IconComponent && (
          <IconComponent size={20} className={cn("text-ink-faint shrink-0", plain && "mt-0.5")} aria-hidden />
        )}
        <span className="min-w-0 flex-1">
          <span className="text-body text-ink block font-semibold">{title}</span>
          {summary && !open && (
            <span
              className={cn("text-small text-ink-faint mt-0.5 block", typeof summary === "string" && "line-clamp-2")}
            >
              {summary}
            </span>
          )}
        </span>
        <ExpandIcon
          size={18}
          weight="bold"
          className={cn(
            "text-ink-faint duration-base shrink-0 transition-transform ease-out",
            plain && "mt-1",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>
      {peek && !open && <div className={cn("pb-3", plain ? "pl-8" : "px-4")}>{peek}</div>}
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
            <div className={plain ? "pt-3 pb-1" : "px-4 pt-1 pb-4"}>{children}</div>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}
