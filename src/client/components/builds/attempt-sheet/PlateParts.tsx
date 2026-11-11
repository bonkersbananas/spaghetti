import type { Part } from "@shared/api";
import type { Outcome } from "@shared/attempts";
import { type AttemptPart, countsForOutcome } from "@shared/parts";
import { useRef } from "react";
import { Stepper } from "@/components/ui/Stepper";
import { cn } from "@/lib/cn";

interface PlatePartsProps {
  /** The build's parts. Nothing is shown for a build without any. */
  parts: readonly Part[];
  value: readonly AttemptPart[];
  onChange: (value: AttemptPart[]) => void;
  outcome: Outcome | null;
}

/** What the number beside a part means at this point: pieces on the plate, then pieces that came out. */
function hint(outcome: Outcome | null) {
  if (outcome === null) return "How many are on the plate. They count once the print is done.";
  if (outcome === "failed") return "A spaghetti counts none. Raise a number if some pieces came out.";
  return "How many good pieces came out.";
}

/**
 * "What's on the plate": the build's parts as chips to tap, each with the count of good pieces that came out. One
 * plate can hold several parts, and a part can take several attempts; the counts feed each part's progress.
 */
export function PlateParts({ parts, value, onChange, outcome }: PlatePartsProps) {
  if (!parts.length) return null;
  const countOf = (partId: string) => value.find((entry) => entry.partId === partId)?.count;
  const toggle = (part: Part) =>
    onChange(
      countOf(part.id) === undefined
        ? [...value, { partId: part.id, count: outcome === "failed" ? 0 : 1 }]
        : value.filter((entry) => entry.partId !== part.id),
    );
  const setCount = (part: Part, count: number) =>
    onChange(value.map((entry) => (entry.partId === part.id ? { ...entry, count } : entry)));
  return (
    <fieldset className="flex flex-col gap-2.5" data-testid="plate-parts">
      <legend className="text-small text-ink-soft mb-2.5 px-0.5 font-semibold">What's on the plate</legend>
      {/* Each part is one unit: a row on phones (the name toggles it, its stepper sits at the right edge only while it is
          on the plate, so the steppers line up under the thumb), a capsule on desktop that flows. */}
      <div className="flex flex-col gap-1.5 md:flex-row md:flex-wrap md:gap-2">
        {parts.map((part) => {
          const count = countOf(part.id);
          const picked = count !== undefined;
          return (
            <div
              key={part.id}
              className={cn(
                "duration-fast md:rounded-pill flex items-center justify-between gap-2 rounded-md pr-1 transition-colors",
                picked ? "bg-basil-soft text-basil-ink ring-basil/40 ring-1 ring-inset" : "bg-ink/4 text-ink-soft",
              )}
            >
              <button
                type="button"
                aria-pressed={picked}
                onClick={() => toggle(part)}
                className="pressable focus-ring text-body md:text-small md:rounded-pill min-h-11 min-w-0 flex-1 rounded-md px-3.5 text-left font-semibold md:min-h-8 md:pr-2"
              >
                {part.name}
              </button>
              {picked && (
                <Stepper
                  label={`${part.name}, pieces`}
                  value={count}
                  max={999}
                  onChange={(next) => setCount(part, next)}
                />
              )}
            </div>
          );
        })}
      </div>
      {value.length > 0 && <p className="text-small text-ink-faint px-0.5">{hint(outcome)}</p>}
    </fieldset>
  );
}

/**
 * The counts that go with an outcome as it is picked: a spaghetti zeroes them, and coming back from one
 * brings back what was on the plate.
 */
export function useOutcomeCounts() {
  const onPlate = useRef<AttemptPart[]>([]);
  return (parts: readonly AttemptPart[], outcome: Outcome | null): AttemptPart[] => {
    if (outcome === "failed" && parts.some((entry) => entry.count > 0)) onPlate.current = [...parts];
    return countsForOutcome(parts, outcome, onPlate.current);
  };
}
