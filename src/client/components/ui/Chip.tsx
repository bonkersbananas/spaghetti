import type { ComponentPropsWithRef, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { ExpandIcon, type Icon } from "./icons";

export type ChipTone = "neutral" | "tomato" | "basil" | "semolina";

const tones: Record<ChipTone, string> = {
  neutral: "bg-ink/6 text-ink-soft",
  tomato: "bg-tomato-soft text-tomato-ink",
  basil: "bg-basil-soft text-basil-ink",
  semolina: "bg-semolina-soft text-semolina-ink",
};

/** A suggestion that comes along if taken (Claude's tags from the photo): outlined, no fill, until it is picked. */
const suggestedTones: Record<ChipTone, string> = {
  neutral: "border border-dashed border-ink/30 text-ink-soft",
  tomato: "border border-dashed border-tomato/60 text-tomato-ink",
  basil: "border border-dashed border-basil/60 text-basil-ink",
  semolina: "border border-dashed border-semolina/70 text-semolina-ink",
};

const base = "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-pill px-2.5 text-small font-semibold md:h-6";

interface ChipProps {
  tone?: ChipTone;
  icon?: Icon;
  /** Outlined instead of filled: a suggestion, not yet anyone's choice. */
  suggested?: boolean;
  /** Drawn over a photo: the neutral tone is dark glass (veil) like every badge over a photo, since its 6 % tint would let the picture through. */
  onPhoto?: boolean;
  children: ReactNode;
  className?: string;
}

/** A label: status, material, tag. Static; for filters use ToggleChip. */
export function Chip({ tone = "neutral", icon: IconComponent, suggested, onPhoto, children, className }: ChipProps) {
  return (
    <span
      className={cn(
        base,
        suggested
          ? suggestedTones[tone]
          : onPhoto && tone === "neutral"
            ? "bg-veil text-on-veil backdrop-blur-md"
            : tones[tone],
        className,
      )}
    >
      {IconComponent && <IconComponent size={14} weight="bold" aria-hidden />}
      {children}
    </span>
  );
}

interface ToggleChipProps extends Omit<ComponentPropsWithRef<"button">, "children"> {
  /** Whether it is on. Leave out for a chip that only does something (no pressed state to announce). */
  selected?: boolean;
  icon?: Icon;
  /** How it looks when picked: ink (filters), or a tone for tags (a failure in tomato, a success in basil). */
  tone?: ChipTone;
  /** Starts with a picture (a spool disc, a swatch) that sits closer to the edge than a word would. */
  lead?: boolean;
  children: ReactNode;
}

const selectedTones: Record<ChipTone, string> = {
  neutral: "bg-select text-on-select",
  tomato: "bg-tomato-soft text-tomato-ink ring-1 ring-inset ring-tomato/40",
  basil: "bg-basil-soft text-basil-ink ring-1 ring-inset ring-basil/40",
  semolina: "bg-semolina-soft text-semolina-ink ring-1 ring-inset ring-semolina/50",
};

/** A chip people tap to filter or pick. Without `selected` it is a button that adds something (a spool for a filament, a kind of change). */
export function ToggleChip({
  selected,
  icon: IconComponent,
  tone = "neutral",
  lead,
  children,
  className,
  ...props
}: ToggleChipProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        base,
        "pressable focus-ring touch-target relative h-9 md:h-8",
        lead ? "gap-2 pr-3.5 pl-2" : "px-3.5",
        selected ? selectedTones[tone] : "bg-cream text-ink-soft shadow-soft hover:text-ink",
        className,
      )}
      {...props}
    >
      {IconComponent && <IconComponent size={16} weight={selected ? "fill" : "regular"} aria-hidden />}
      {children}
    </button>
  );
}

/**
 * A long row of choices cut short: the first `visible` plus any that are
 * picked, so a pick never hides, and the rest behind a "N more" chip
 * (`MoreChip`). Pass `expanded` once that chip was tapped. Shared by the tag
 * pickers and the spool page's Material and Finish rows.
 */
export function collapseChips<T>(
  items: readonly T[],
  { visible, picked, expanded }: { visible: number; picked: (item: T) => boolean; expanded: boolean },
): { shown: T[]; hidden: number } {
  const shown = expanded ? [...items] : items.filter((item, index) => index < visible || picked(item));
  return { shown, hidden: items.length - shown.length };
}

/** "4 more": the chip that opens what `collapseChips` left out. */
export function MoreChip({ hidden, onClick }: { hidden: number; onClick: () => void }) {
  return (
    <ToggleChip selected={false} onClick={onClick} className="text-ink-faint">
      {hidden} more
    </ToggleChip>
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
