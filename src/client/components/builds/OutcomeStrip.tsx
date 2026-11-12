import { OUTCOME_LABELS, type Outcome } from "@shared/attempts";
import { FinishIcon, PrintingIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import { outcomeDots, outcomeIcons } from "./Outcome";

/** Dots shown at most; earlier attempts collapse into a count. */
const MAX_DOTS = 12;

interface StripAttempt {
  id: string;
  number: number;
  /** Null while it is printing. */
  outcome: Outcome | null;
  /** The printer bridge saw it stop and nobody has said how it went: off the bed, not printing. */
  offBed?: boolean;
}

interface OutcomeStripProps {
  /** Oldest first. */
  attempts: StripAttempt[];
  /** Makes each dot a button that picks that attempt. */
  onPick?: (attemptId: string) => void;
  /** With `onPick`: the attempt that is open now, drawn as the picked one. */
  selected?: string | null;
  className?: string;
}

const word = (attempt: StripAttempt) =>
  attempt.outcome ? OUTCOME_LABELS[attempt.outcome].toLowerCase() : attempt.offBed ? "off the bed" : "printing";

/** "3 attempts: spaghetti, partly, printing". */
export function outcomeSentence(attempts: StripAttempt[]): string {
  return `${attempts.length} ${attempts.length === 1 ? "attempt" : "attempts"}: ${attempts.map((a) => word(a)).join(", ")}`;
}

/**
 * A build's attempts as a row of dots, oldest first, each in its outcome's
 * color (semolina and pulsing while it prints). Color never carries the
 * meaning alone, so the strip says it in words for screen readers and every
 * use pairs it with a sentence. Long builds show the latest twelve and a
 * "+5" for the rest. With `onPick` it becomes a row of attempt tiles (AttemptPicker).
 */
export function OutcomeStrip({ attempts, onPick, selected, className }: OutcomeStripProps) {
  if (attempts.length === 0) return null;
  if (onPick) return <AttemptPicker attempts={attempts} onPick={onPick} selected={selected} className={className} />;
  const hidden = Math.max(0, attempts.length - MAX_DOTS);
  const shown = attempts.slice(hidden);
  const sentence = outcomeSentence(attempts);
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      {hidden > 0 && (
        <span aria-hidden className="text-caption text-ink-faint tabular">
          +{hidden}
        </span>
      )}
      <span className="relative inline-flex items-center gap-1.5">
        <span aria-hidden className="bg-ink/10 absolute inset-x-1.25 top-1/2 h-0.5 -translate-y-1/2" />
        {shown.map((attempt) => {
          const dot = cn(
            "relative size-2.5 shrink-0 rounded-full",
            outcomeDots[attempt.outcome ?? (attempt.offBed ? "offBed" : "printing")],
            attempt.outcome === null && !attempt.offBed && "animate-pulse",
          );
          return <span key={attempt.id} aria-hidden className={dot} />;
        })}
      </span>
      <span className="sr-only">{sentence}</span>
    </span>
  );
}

const tileTones: Record<Outcome, string> = {
  success: "bg-basil-soft text-basil-ink",
  partial: "bg-semolina-soft text-semolina-ink",
  failed: "bg-tomato-soft text-tomato-ink",
};

/**
 * The strip as a control: one tile per attempt, each a full touch target with its number and the outcome's own
 * icon (shape as well as color), in the outcome's soft tones; the open one is inverted like a picked chip.
 * Wraps rather than scrolls, so every attempt is in view and under a thumb.
 */
function AttemptPicker({
  attempts,
  onPick,
  selected,
  className,
}: Required<Pick<OutcomeStripProps, "attempts" | "onPick">> & Pick<OutcomeStripProps, "selected" | "className">) {
  const hidden = Math.max(0, attempts.length - MAX_DOTS);
  return (
    <fieldset
      aria-label={outcomeSentence(attempts)}
      className={cn("m-0 flex min-w-0 flex-wrap items-center gap-2 border-0 p-0", className)}
    >
      {hidden > 0 && (
        <span aria-hidden className="text-caption text-ink-faint tabular">
          +{hidden}
        </span>
      )}
      {attempts.slice(hidden).map((attempt) => {
        const name = `Attempt ${attempt.number}: ${word(attempt)}`;
        const Icon = attempt.outcome ? outcomeIcons[attempt.outcome] : attempt.offBed ? FinishIcon : PrintingIcon;
        const picked = attempt.id === selected;
        return (
          <button
            key={attempt.id}
            type="button"
            title={name}
            aria-label={name}
            aria-current={picked ? "true" : undefined}
            onClick={() => onPick(attempt.id)}
            className={cn(
              "pressable focus-ring text-small tabular inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-md px-2.5 font-semibold md:h-8",
              picked
                ? "bg-select text-on-select"
                : attempt.outcome
                  ? tileTones[attempt.outcome]
                  : attempt.offBed
                    ? "bg-ink/6 text-ink-soft"
                    : "bg-semolina-soft text-semolina-ink",
            )}
          >
            <Icon
              size={16}
              weight="bold"
              aria-hidden
              className={attempt.outcome === null && !attempt.offBed ? "animate-pulse" : undefined}
            />
            {attempt.number}
          </button>
        );
      })}
    </fieldset>
  );
}
