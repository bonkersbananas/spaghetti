import { OUTCOME_LABELS, OUTCOMES, type Outcome } from "@shared/attempts";
import { m } from "motion/react";
import { useState } from "react";
import { Chip, type ChipTone } from "@/components/ui/Chip";
import { type Icon, PartlyIcon, PrintingIcon, SpaghettiIcon, WorkedIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import { tap } from "@/lib/haptics";
import { spring } from "@/lib/motion";

export const outcomeIcons: Record<Outcome, Icon> = {
  success: WorkedIcon,
  partial: PartlyIcon,
  failed: SpaghettiIcon,
};

export const outcomeTones: Record<Outcome, Exclude<ChipTone, "neutral">> = {
  success: "basil",
  partial: "semolina",
  failed: "tomato",
};

const selectedStyles: Record<Outcome, string> = {
  success: "bg-basil-soft text-basil-ink ring-basil",
  partial: "bg-semolina-soft text-semolina-ink ring-semolina",
  failed: "bg-tomato-soft text-tomato-ink ring-tomato",
};

/** The dot on the timeline: the outcome's color, or semolina while printing. */
export const outcomeDots: Record<Outcome | "printing", string> = {
  success: "bg-basil",
  partial: "bg-semolina",
  failed: "bg-tomato",
  printing: "bg-semolina",
};

interface OutcomePickerProps {
  value: Outcome | null;
  onChange: (outcome: Outcome) => void;
  /** "lg" in the attempt sheet (one tap, thumb-sized); "md" where it is a secondary choice. */
  size?: "md" | "lg";
  className?: string;
}

/**
 * How it went, in one tap: worked, partly, or spaghetti. Big targets, the
 * picked one in its color. A failure is recorded with the same care as a
 * success, so spaghetti is never styled as an error.
 */
export function OutcomePicker({ value, onChange, size = "lg", className }: OutcomePickerProps) {
  // The picked icon springs in, but only for a pick made here: opening an attempt that already has an outcome doesn't.
  const [picked, setPicked] = useState(false);
  return (
    <div role="radiogroup" aria-label="How did it go?" className={cn("grid grid-cols-3 gap-2.5", className)}>
      {OUTCOMES.map((outcome) => {
        const OutcomeIcon = outcomeIcons[outcome];
        const selected = value === outcome;
        return (
          // biome-ignore lint/a11y/useSemanticElements: big tactile buttons; a radio input can't be styled like this.
          <button
            key={outcome}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => {
              setPicked(true);
              tap();
              onChange(outcome);
            }}
            className={cn(
              "pressable focus-ring flex flex-col items-center justify-center gap-1.5 rounded-lg font-semibold",
              size === "lg" ? "text-body h-22 md:h-20" : "text-small h-16 gap-1",
              selected
                ? cn(selectedStyles[outcome], "ring-2 ring-inset")
                : "bg-paper text-ink-soft shadow-soft hover:text-ink hover:shadow-raised",
            )}
          >
            {/* Keyed on being picked, so the icon is new when it is, and answers the tap with a small spring. */}
            <m.span
              key={selected ? "picked" : "idle"}
              initial={selected && picked ? { scale: 0.8 } : false}
              animate={{ scale: 1 }}
              transition={spring.snappy}
              className="flex"
            >
              <OutcomeIcon size={size === "lg" ? 30 : 24} weight={selected ? "duotone" : "regular"} aria-hidden />
            </m.span>
            {OUTCOME_LABELS[outcome]}
          </button>
        );
      })}
    </div>
  );
}

interface OutcomeChipProps {
  /** null: still printing. */
  outcome: Outcome | null;
  className?: string;
}

/** How an attempt went, as a chip; "Printing" with a gentle pulse while it runs. */
export function OutcomeChip({ outcome, className }: OutcomeChipProps) {
  if (!outcome) {
    return (
      <Chip tone="semolina" className={className}>
        <span className="relative flex size-2" aria-hidden>
          <span className="bg-semolina absolute inline-flex size-full animate-ping rounded-full opacity-60" />
          <span className="bg-semolina relative inline-flex size-2 rounded-full" />
        </span>
        Printing
      </Chip>
    );
  }
  return (
    <Chip tone={outcomeTones[outcome]} icon={outcomeIcons[outcome]} className={className}>
      {OUTCOME_LABELS[outcome]}
    </Chip>
  );
}

export { PrintingIcon };
