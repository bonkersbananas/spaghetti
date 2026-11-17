import type { ComponentPropsWithRef, ReactNode } from "react";
import { cn } from "@/lib/cn";
import type { Icon } from "./icons";

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
  /**
   * `quiet`: words with no chip around them until picked, for a filter or two beside a section's heading (Ideas'
   * "Has a model" beside "The rest"); picked, the same ink pill as a picked chip, tight around the label and count. With
   * a `tone` other than neutral it is a status instead (Up next, My wishlist on an idea): picked, the tone's soft fill.
   */
  appearance?: "chip" | "quiet";
  /** How many it would show, after the label: faint at rest, in the pill's own ink once picked. */
  count?: number;
  children: ReactNode;
}

const selectedTones: Record<ChipTone, string> = {
  neutral: "bg-select text-on-select",
  tomato: "bg-tomato-soft text-tomato-ink ring-1 ring-inset ring-tomato/40",
  basil: "bg-basil-soft text-basil-ink ring-1 ring-inset ring-basil/40",
  semolina: "bg-semolina-soft text-semolina-ink ring-1 ring-inset ring-semolina/50",
};

/** A quiet toggle that is on and has a status colour (Up next, My wishlist): the tone's soft fill, no ring, never the ink pill that means "picked filter". */
const quietSelectedTones: Record<ChipTone, string> = {
  neutral: "bg-ink/8 text-ink",
  tomato: "bg-tomato-soft text-tomato-ink",
  basil: "bg-basil-soft text-basil-ink",
  semolina: "bg-semolina-soft text-semolina-ink",
};

/** A chip people tap to filter or pick. Without `selected` it is a button that adds something (a spool for a filament, a kind of change). */
export function ToggleChip({
  selected,
  icon: IconComponent,
  tone = "neutral",
  lead,
  appearance = "chip",
  count,
  children,
  className,
  ...props
}: ToggleChipProps) {
  const quiet = appearance === "quiet";
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        base,
        "pressable focus-ring touch-target relative",
        quiet ? "h-7 px-2.5" : cn("h-9 md:h-8", lead ? "gap-2 pr-3.5 pl-2" : "px-3.5"),
        selected
          ? quiet && tone !== "neutral"
            ? quietSelectedTones[tone]
            : selectedTones[tone]
          : quiet
            ? "text-ink-soft hover:bg-ink/5 hover:text-ink"
            : "bg-cream text-ink-soft shadow-soft hover:text-ink",
        className,
      )}
      {...props}
    >
      {IconComponent && <IconComponent size={16} weight={selected ? "fill" : "regular"} aria-hidden />}
      {children}
      {count !== undefined && (
        <span className={cn("tabular font-medium", selected ? "opacity-70" : "text-ink-faint")}>{count}</span>
      )}
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
