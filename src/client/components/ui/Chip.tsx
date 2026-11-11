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
  children: ReactNode;
  className?: string;
}

/** A label: status, material, tag. Static; for filters use ToggleChip. */
export function Chip({ tone = "neutral", icon: IconComponent, suggested, children, className }: ChipProps) {
  return (
    <span className={cn(base, suggested ? suggestedTones[tone] : tones[tone], className)}>
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
  children: ReactNode;
}

const selectedTones: Record<ChipTone, string> = {
  neutral: "bg-select text-on-select",
  tomato: "bg-tomato-soft text-tomato-ink ring-1 ring-inset ring-tomato/40",
  basil: "bg-basil-soft text-basil-ink ring-1 ring-inset ring-basil/40",
  semolina: "bg-semolina-soft text-semolina-ink ring-1 ring-inset ring-semolina/50",
};

/** A chip people tap to filter or pick. */
export function ToggleChip({
  selected,
  icon: IconComponent,
  tone = "neutral",
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
        "pressable focus-ring touch-target relative h-9 px-3.5 md:h-8",
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
