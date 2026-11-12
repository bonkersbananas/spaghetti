import { summarizeBuild } from "@shared/attempts";
import { isOffTheBed } from "@shared/print-progress";
import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { MetaList } from "@/components/ui/MetaList";
import { Overline } from "@/components/ui/Overline";
import { Swatch } from "@/components/ui/Swatch";
import type { AttemptView } from "@/lib/items";
import { OutcomeStrip } from "./OutcomeStrip";
import { formatMinutes } from "./settings";

/** Filaments named before "+2 more". */
const MAX_FILAMENTS = 4;

/**
 * What a build's story adds up to, under its notes: reference text on paper,
 * no surface of its own. The strip of dots (tap one to go to that attempt)
 * with how they went in words, the time and filament spent, and every filament
 * used. Shown from the second attempt on; one attempt only repeats the story.
 */
export function BuildSummary({
  attempts,
  open,
  onPick,
  selected,
}: {
  /** Oldest first. */
  attempts: AttemptView[];
  /** The build is still going ("So far"); otherwise it is done or shelved ("In all"). */
  open: boolean;
  onPick: (attemptId: string) => void;
  /** The attempt that is open now. */
  selected?: string | null;
}) {
  const summary = useMemo(() => summarizeBuild(attempts), [attempts]);
  if (attempts.length < 2) return null;
  const { minutes, grams, filaments } = summary;
  const figures = [
    minutes && `${minutes.approximate ? "about " : ""}${formatMinutes(minutes.value)} on the bed`,
    grams && `${grams.atLeast ? "at least " : ""}${Math.round(grams.value)} g of filament`,
  ].filter((figure): figure is string => !!figure);
  return (
    <section aria-label="Summary" className="mt-2 flex flex-col gap-2">
      <Overline as="h2">{open ? "So far" : "In all"}</Overline>
      <div className="flex flex-col gap-2.5">
        <OutcomeStrip
          attempts={attempts.map(({ id, number, outcome, endedAt }) => ({
            id,
            number,
            outcome,
            offBed: isOffTheBed({ outcome, endedAt }),
          }))}
          onPick={onPick}
          selected={selected}
        />
        <span className="text-small text-ink-soft">{summary.words}</span>
      </div>
      {figures.length > 0 && (
        <MetaList className="text-small text-ink-soft tabular">
          {figures.map((figure) => (
            <span key={figure} className="whitespace-nowrap">
              {figure}
            </span>
          ))}
        </MetaList>
      )}
      {filaments.length > 0 && (
        <ul className="text-small text-ink-soft flex flex-wrap gap-x-3.5 gap-y-1">
          {filaments.slice(0, MAX_FILAMENTS).map((filament) => {
            const name = [filament.colorName, filament.type].filter(Boolean).join(" ") || "Filament";
            const inner = (
              <>
                <Swatch color={filament.colorHex} />
                {name}
              </>
            );
            return (
              <li key={filament.spoolId ?? `${filament.type}|${filament.colorHex ?? filament.colorName}`}>
                {filament.spoolId ? (
                  <Link
                    to="/pantry/$spoolId"
                    params={{ spoolId: filament.spoolId }}
                    className="focus-ring touch-target hover:text-ink relative -mx-1 inline-flex items-center gap-1.5 rounded-xs px-1 font-medium"
                  >
                    {inner}
                  </Link>
                ) : (
                  <span className="inline-flex items-center gap-1.5 font-medium">{inner}</span>
                )}
              </li>
            );
          })}
          {filaments.length > MAX_FILAMENTS && (
            <li className="text-ink-faint">+{filaments.length - MAX_FILAMENTS} more</li>
          )}
        </ul>
      )}
    </section>
  );
}
