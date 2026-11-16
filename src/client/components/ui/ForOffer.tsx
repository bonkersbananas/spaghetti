import { type ComponentPropsWithRef, type ReactNode, useState } from "react";
import { cn } from "@/lib/cn";
import { ExpandIcon, InviteIcon, RenameIcon } from "./icons";
import { MenuGroup, MenuItem } from "./Menu";
import { PopoverAnchor, PopoverPanel, PopoverRoot, PopoverTrigger } from "./Popover";

interface ForOfferProps {
  /** The other person's name: one tap names them. Unknown (the people haven't loaded), only "For someone…" is offered. */
  name?: string;
  /** Name them: the page sets its "for" line, and this offer goes. */
  onName: (name: string) => void;
  /** "Someone else…": the page opens its empty `ForField` with the focus in it. */
  onAsk: () => void;
}

/**
 * Who it is for, offered once among a title's chips while nobody is named: "For Sam" in one tap, and "Someone else…"
 * behind the caret, which opens the `ForField`. Dashed, as an offer and not a fact; once someone is named the page
 * shows the "for Sam" line instead.
 */
export function ForOffer({ name, onName, onAsk }: ForOfferProps) {
  const [open, setOpen] = useState(false);
  if (!name) return <OfferChip onClick={onAsk}>For someone…</OfferChip>;
  return (
    <PopoverRoot open={open} onOpenChange={setOpen}>
      {/* The menu hangs from the whole offer, under its first word, not from the caret. */}
      <PopoverAnchor asChild>
        <span className="inline-flex">
          <OfferChip
            onClick={() => onName(name)}
            more={
              <PopoverTrigger asChild>
                <OfferMore label="For someone else" />
              </PopoverTrigger>
            }
          >
            For {name}
          </OfferChip>
        </span>
      </PopoverAnchor>
      {/* max-w: a menu's 18 rem is wide for two short rows (the panel's own width class can't be overridden). */}
      <PopoverPanel label="Who it is for" side="bottom" align="start" className="max-w-60">
        <MenuGroup size="sm" className="mx-0">
          <MenuItem
            icon={InviteIcon}
            className="max-md:h-11"
            onClick={() => {
              setOpen(false);
              onName(name);
            }}
          >
            For {name}
          </MenuItem>
          <MenuItem
            icon={RenameIcon}
            className="max-md:h-11"
            onClick={() => {
              setOpen(false);
              onAsk();
            }}
          >
            Someone else…
          </MenuItem>
        </MenuGroup>
      </PopoverPanel>
    </PopoverRoot>
  );
}

interface OfferChipProps extends Omit<ComponentPropsWithRef<"button">, "children"> {
  children: ReactNode;
  /** More choices at its end, after a hairline: an `OfferMore` (wrapped in a `PopoverTrigger`). */
  more?: ReactNode;
}

const offerSegment =
  "pressable focus-ring touch-target relative inline-flex items-center rounded-pill hover:text-ink disabled:pointer-events-none";

/**
 * An offer to set something nobody has set yet ("For Sam"): dashed and unfilled, so it never reads as a fact (a
 * `Chip`) or as a toggle that is off (a `ToggleChip`). Taking it sets the thing, and the offer goes: what was set
 * shows as itself (the "for Sam" line), not as a chip.
 */
export function OfferChip({ children, more, className, ...props }: OfferChipProps) {
  return (
    <span
      className={cn(
        "rounded-pill text-small text-ink-soft border-ink/25 inline-flex h-9 shrink-0 items-stretch border border-dashed font-semibold md:h-8",
        className,
      )}
    >
      <button type="button" className={cn(offerSegment, more ? "pr-2 pl-3.5" : "px-3.5")} {...props}>
        {children}
      </button>
      {more}
    </span>
  );
}

/** The caret at an `OfferChip`'s end that opens its other choices ("Someone else…"). Takes a trigger's props. */
export function OfferMore({
  label,
  className,
  ...props
}: Omit<ComponentPropsWithRef<"button">, "children"> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      className={cn(
        offerSegment,
        "before:bg-ink/15 pr-2.5 pl-2 before:absolute before:inset-y-2 before:left-0 before:w-px",
        className,
      )}
      {...props}
    >
      <ExpandIcon size={14} weight="bold" aria-hidden />
    </button>
  );
}
