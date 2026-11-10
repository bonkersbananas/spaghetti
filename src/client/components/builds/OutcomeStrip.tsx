import { OUTCOME_LABELS, type Outcome } from "@shared/attempts";
import { cn } from "@/lib/cn";
import { outcomeDots } from "./Outcome";

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
 * "+5" for the rest. With `onPick`, each dot is a button.
 */
export function OutcomeStrip({ attempts, onPick, className }: OutcomeStripProps) {
  if (attempts.length === 0) return null;
  const hidden = Math.max(0, attempts.length - MAX_DOTS);
  const shown = attempts.slice(hidden);
  const sentence = outcomeSentence(attempts);
  return (
    <span
      className={cn("inline-flex items-center gap-1.5", className)}
      {...(onPick ? { role: "group", "aria-label": sentence } : {})}
    >
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
            outcomeDots[attempt.outcome ?? "printing"],
            attempt.outcome === null && !attempt.offBed && "animate-pulse",
          );
          if (!onPick) return <span key={attempt.id} aria-hidden className={dot} />;
          const name = `Attempt ${attempt.number}: ${word(attempt)}`;
          return (
            <button
              key={attempt.id}
              type="button"
              title={name}
              aria-label={name}
              onClick={() => onPick(attempt.id)}
              // A 44 px tall target a dot-and-gap wide: the dots sit 16 px apart, so wider targets would overlap and
              // the last one would take every tap.
              className={cn(dot, "focus-ring after:absolute after:-inset-x-0.75 after:-inset-y-4.5 after:content-['']")}
            />
          );
        })}
      </span>
      {!onPick && <span className="sr-only">{sentence}</span>}
    </span>
  );
}
