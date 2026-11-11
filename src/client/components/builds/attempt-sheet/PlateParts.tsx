import type { Part } from "@shared/api";
import type { Outcome } from "@shared/attempts";
import { type AttemptPart, countsForOutcome } from "@shared/parts";
import { useRef } from "react";
import { ToggleChip } from "@/components/ui/Chip";
import { Stepper } from "@/components/ui/Stepper";

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
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {parts.map((part) => {
          const count = countOf(part.id);
          return (
            <span key={part.id} className="inline-flex items-center gap-1.5">
              <ToggleChip selected={count !== undefined} onClick={() => toggle(part)}>
                {part.name}
              </ToggleChip>
              {count !== undefined && (
                <Stepper
                  label={`${part.name}, pieces`}
                  value={count}
                  max={999}
                  onChange={(next) => setCount(part, next)}
                />
              )}
            </span>
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
