import { type ReactNode, useId } from "react";
import { cn } from "@/lib/cn";
import type { Icon } from "./icons";

interface OfferCardProps {
  /** A small glyph of what is offered (the coins for prices). */
  icon?: Icon;
  /** What is in it for them, in a few words: "8 things could show their prices". */
  title: ReactNode;
  /** One quiet line under it: who found it, a `ClaudeLine` when it was Claude. */
  detail?: ReactNode;
  /** The one answer, a `Button variant="secondary" size="sm"`, beside the words at every width. */
  action: ReactNode;
  className?: string;
}

/**
 * Something to do for the whole page, offered once at its top (Match prices on the shopping list): one of the soft
 * cream cards, as the notification offer is, not a grey well (wells are fields). The words and the button share a
 * row at every width, so on a phone it is about two lines tall. A region named by its title.
 */
export function OfferCard({ icon: Glyph, title, detail, action, className }: OfferCardProps) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className={cn(
        "bg-cream shadow-soft grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 rounded-lg py-3 pr-3 pl-3.5 md:gap-x-6 md:py-3.5 md:pr-4 md:pl-5",
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <p id={id} className="text-body text-ink flex items-center gap-2 font-semibold text-pretty">
          {Glyph && <Glyph size={18} className="text-ink-faint shrink-0" aria-hidden />}
          <span className="min-w-0">{title}</span>
        </p>
        {detail}
      </div>
      <div className="flex shrink-0 items-center">{action}</div>
    </section>
  );
}
