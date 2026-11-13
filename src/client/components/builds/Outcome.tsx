import { OUTCOME_LABELS, OUTCOMES, type Outcome } from "@shared/attempts";
import { m } from "motion/react";
import { type CSSProperties, useState } from "react";
import { AutoHeight } from "@/components/ui/AutoHeight";
import { Chip, type ChipTone } from "@/components/ui/Chip";
import {
  FinishIcon,
  type Icon,
  PartlyIcon,
  PrintingIcon,
  SpaghettiIcon,
  SparkleIcon,
  WorkedIcon,
} from "@/components/ui/icons";
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
const suggestedMarks: Record<Outcome, string> = {
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
  const kind = picked && value === "failed";
  return (
    <>
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
                "pressable focus-ring relative flex flex-col items-center justify-center gap-1.5 rounded-lg font-semibold",
                size === "lg" ? "text-body h-22 md:h-20" : "text-small h-16 gap-1",
                selected
                  ? cn(selectedStyles[outcome], "ring-2 ring-inset")
                  : hinted
                    ? cn(suggestedStyles[outcome], "hover:bg-ink/4")
                    : "bg-tile text-ink-soft shadow-soft hover:text-ink hover:shadow-raised",
              )}
            >
              {/* Picked is the bold weight, not duotone: duotone redraws "Partly" as a circle with one slash, which reads as a prohibited sign.
                Keyed on being picked, so the icon is new when it is, and answers the tap with a small spring. */}
              <m.span
                key={selected ? "picked" : "idle"}
                // Spaghetti settles and tilts back, gently: no pop for the one that didn't go well.
                initial={
                  selected && picked ? (outcome === "failed" ? { scale: 0.9, rotate: -8 } : { scale: 0.8 }) : false
                }
                animate={{ scale: 1, rotate: 0 }}
                transition={outcome === "failed" ? spring.gentle : spring.snappy}
                className={cn("relative flex", hinted && suggestedIcons[outcome])}
              >
                <OutcomeIcon size={size === "lg" ? 30 : 24} weight={selected ? "bold" : "regular"} aria-hidden />
                {selected && picked && outcome === "success" && <Sprinkle />}
              </m.span>
              {OUTCOME_LABELS[outcome]}
              {hinted && (
                // Claude's sparkle in the corner (as in its lines) and the word for screen readers: nothing in the flow, so the
                // icon and the label stay centered in the square, like the other two.
                <>
                  <span
                    className={cn(
                      "absolute",
                      size === "lg" ? "top-2 right-2" : "top-1.5 right-1.5",
                      suggestedMarks[outcome],
                    )}
                  >
                    <SparkleIcon size={14} weight="fill" aria-hidden />
                  </span>
                  <span className="sr-only"> suggested</span>
                </>
              )}
            </button>
          );
        })}
      </div>
      {/* A failure is worth recording: a pick made here is met kindly, in the same quiet voice as the rest. The line grows
        into place (the -mt-3 takes back the gap its box would add while empty) instead of shoving the form down. */}
      {size === "lg" && (
        <AutoHeight trigger={kind} className="-mt-3">
          {kind && (
            <p role="status" className="text-small text-ink-soft sg-fade-in px-0.5 pt-3">
              Good one to have on record. It shows the next try what to change.
            </p>
          )}
        </AutoHeight>
      )}
    </>
  );
}

/** A pinch of grated parmesan thrown off the check when something worked: six specks fly out and fade (CSS only, once). */
function Sprinkle() {
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0">
      {[0, 60, 120, 180, 240, 300].map((angle) => (
        <span
          key={angle}
          className="sg-speck bg-semolina rounded-pill absolute top-1/2 left-1/2 -mt-0.5 -ml-0.5 size-1.5"
          style={{ "--sg-angle": `${angle + 20}deg` } as CSSProperties} // design-lint-ignore
        />
      ))}
    </span>
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
