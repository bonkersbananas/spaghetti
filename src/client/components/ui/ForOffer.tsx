import type { ComponentPropsWithRef, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { PlusIcon, RenameIcon } from "./icons";

interface ForOfferProps {
  /** The other person's name: one tap names them. Unknown (the people haven't loaded), only "For someone" is offered. */
  name?: string;
  /** Name them: the page sets its "for" line, and this offer goes. */
  onName: (name: string) => void;
  /** Someone else: the page opens its empty `ForField` with the focus in it. */
  onAsk: () => void;
  /** On phones say only the first name ("For Sam"), so a row of chips stays on one line; taking it still names them in full. */
  firstNameOnPhones?: boolean;
  /** Onto the offer's ring, such as `max-md:h-7` to match quiet chips beside it. */
  className?: string;
}

/**
 * Who it is for, offered once among a title's chips while nobody is named: "For Sam" in one tap, and the pencil at
 * its end to write someone else in the `ForField` line. Once someone is named the page shows the "for Sam" line
 * instead.
 */
export function ForOffer({ name, onName, onAsk, firstNameOnPhones = false, className }: ForOfferProps) {
  if (!name)
    return (
      <OfferChip onClick={onAsk} className={className}>
        For someone
      </OfferChip>
    );
  const space = name.indexOf(" ");
  const rest = firstNameOnPhones && space > 0 ? name.slice(space) : "";
  return (
    <OfferChip
      className={className}
      onClick={() => onName(name)}
      aria-label={`For ${name}`}
      more={<OfferMore label="For someone else" onClick={onAsk} />}
    >
      {/* One inline run, so the button's gap never opens between the first name and the rest. */}
      <span>
        For {rest ? name.slice(0, space) : name}
        {rest && <span className="max-md:hidden">{rest}</span>}
      </span>
    </OfferChip>
  );
}

interface OfferChipProps extends Omit<ComponentPropsWithRef<"button">, "children"> {
  children: ReactNode;
  /** A second choice at its end, after a hairline: an `OfferMore`. */
  more?: ReactNode;
}

const segment =
  "pressable focus-ring touch-target relative inline-flex items-center rounded-pill hover:text-ink disabled:pointer-events-none";

/**
 * An offer to set something nobody has set yet ("+ For Sam"): a plus and a dashed ring, no fill, so it never reads as
 * a fact (a `Chip`) or as a toggle that is off (a `ToggleChip`). Taking it sets the thing and the offer goes: what was
 * set shows as itself (the "for Sam" line), not as a chip. The ring is ink at 55 %, 3:1 on paper.
 */
export function OfferChip({ children, more, className, ...props }: OfferChipProps) {
  return (
    <span
      className={cn(
        "rounded-pill text-small text-ink-soft border-ink/55 inline-flex h-9 shrink-0 items-stretch border border-dashed font-semibold md:h-8",
        className,
      )}
    >
      <button type="button" className={cn(segment, "gap-1.5 pl-2.5", more ? "pr-2.5" : "pr-3.5")} {...props}>
        <PlusIcon size={14} weight="bold" aria-hidden />
        {children}
      </button>
      {more}
    </span>
  );
}

/** The other choice at an `OfferChip`'s end, an icon after a hairline: the pencil that writes someone else. */
export function OfferMore({
  label,
  className,
  ...props
}: Omit<ComponentPropsWithRef<"button">, "children"> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        segment,
        "before:bg-ink/20 pr-3 pl-2.5 before:absolute before:inset-y-2 before:left-0 before:w-px",
        className,
      )}
      {...props}
    >
      <RenameIcon size={15} aria-hidden />
    </button>
  );
}
