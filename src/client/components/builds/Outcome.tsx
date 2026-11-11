import { OUTCOME_LABELS, OUTCOMES, type Outcome } from "@shared/attempts";
import { m } from "motion/react";
import { useState } from "react";
import { Chip, type ChipTone } from "@/components/ui/Chip";
import { FinishIcon, type Icon, PartlyIcon, PrintingIcon, SpaghettiIcon, WorkedIcon } from "@/components/ui/icons";
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

/**
 * Claude's suggestion from the photo, on the outcome's button: its own look, not the picked one. No fill and a dashed
 * ring in the outcome's color, the icon in that color; tapping it turns it into the normal picked style.
 */
const suggestedStyles: Record<Outcome, string> = {
  success: "text-ink-soft border-2 border-dashed border-basil/70",
  partial: "text-ink-soft border-2 border-dashed border-semolina",
  failed: "text-ink-soft border-2 border-dashed border-tomato/70",
};
const suggestedIcons: Record<Outcome, string> = {
  success: "text-basil",
  partial: "text-semolina",
  failed: "text-tomato",
};
const suggestedCaptions: Record<Outcome, string> = {
  success: "text-basil-ink",
  partial: "text-semolina-ink",
  failed: "text-tomato-ink",
};

/** The dot on the timeline: the outcome's color, or semolina while printing. */
export const outcomeDots: Record<Outcome | "printing" | "offBed", string> = {
  success: "bg-basil",
  partial: "bg-semolina",
  failed: "bg-tomato",
  printing: "bg-semolina",
  /** Stopped, no verdict yet: neutral, like its chip. */
  offBed: "bg-ink/30",
};

interface OutcomePickerProps {
  value: Outcome | null;
  onChange: (outcome: Outcome) => void;
  /** "lg" in the attempt sheet (one tap, thumb-sized); "md" where it is a secondary choice. */
  size?: "md" | "lg";
  /**
   * The outcome Claude suggests from the photo (decision 0023): hinted on its button, never picked. Tapping it picks it
   * like any other; nothing is saved until then.
   */
  suggested?: Outcome | null;
  className?: string;
}

/**
 * How it went, in one tap: worked, partly, or spaghetti. Big targets, the
 * picked one in its color. A failure is recorded with the same care as a
 * success, so spaghetti is never styled as an error.
 */
export function OutcomePicker({ value, onChange, size = "lg", suggested = null, className }: OutcomePickerProps) {
  // The picked icon springs in, but only for a pick made here: opening an attempt that already has an outcome doesn't.
  const [picked, setPicked] = useState(false);
  return (
    <div role="radiogroup" aria-label="How did it go?" className={cn("grid grid-cols-3 gap-2.5", className)}>
      {OUTCOMES.map((outcome) => {
        const OutcomeIcon = outcomeIcons[outcome];
        const selected = value === outcome;
        const hinted = !value && suggested === outcome;
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
              size === "lg" ? "text-body h-22 md:h-20" : cn("text-small gap-1", suggested && !value ? "h-19" : "h-16"),
              selected
                ? cn(selectedStyles[outcome], "ring-2 ring-inset")
                : hinted
                  ? cn(suggestedStyles[outcome], "hover:bg-ink/4")
                  : "bg-paper text-ink-soft shadow-soft hover:text-ink hover:shadow-raised",
            )}
          >
            {/* Picked is the bold weight, not duotone: duotone redraws "Partly" as a circle with one slash, which reads as a prohibited sign.
                Keyed on being picked, so the icon is new when it is, and answers the tap with a small spring. */}
            <m.span
              key={selected ? "picked" : "idle"}
              initial={selected && picked ? { scale: 0.8 } : false}
              animate={{ scale: 1 }}
              transition={spring.snappy}
              className={cn("flex", hinted && suggestedIcons[outcome])}
            >
              <OutcomeIcon size={size === "lg" ? 30 : 24} weight={selected ? "bold" : "regular"} aria-hidden />
            </m.span>
            {OUTCOME_LABELS[outcome]}
            {suggested && !value && (
              // Every button keeps the caption's line, so the icons and words line up across the row.
              <span
                aria-hidden={!hinted}
                className={cn("text-micro -mt-1 font-normal", hinted ? suggestedCaptions[outcome] : "invisible")}
              >
                suggested
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

interface OutcomeChipProps {
  /** null: still printing. */
  outcome: Outcome | null;
  /** The print stopped on the printer and nobody has said how it went yet (see `isOffTheBed`). */
  offTheBed?: boolean;
  className?: string;
}

/** How an attempt went, as a chip; "Printing" with a gentle pulse while it runs, "Off the bed" once it stopped. */
export function OutcomeChip({ outcome, offTheBed, className }: OutcomeChipProps) {
  if (!outcome && offTheBed) {
    return (
      <Chip tone="neutral" icon={FinishIcon} className={className}>
        Off the bed
      </Chip>
    );
  }
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
