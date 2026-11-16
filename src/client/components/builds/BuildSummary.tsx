import { summarizeBuild } from "@shared/attempts";
import { isOffTheBed } from "@shared/print-progress";
import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { MetaList } from "@/components/ui/MetaList";
import { Overline } from "@/components/ui/Overline";
import { Swatch } from "@/components/ui/Swatch";
import type { AttemptView, PhotoView } from "@/lib/items";
import { photoSrc } from "@/lib/previews";
import { AttemptTrail } from "./AttemptTrail";
import { formatMinutes } from "./settings";

/** Filaments named before "+2 more". */
const MAX_FILAMENTS = 4;

/**
 * What a build's story adds up to, under its notes: reference text on paper,
 * no surface of its own. How the attempts went in words, then the trail of
 * attempts (tap one to go to it), the time and filament spent, and every
 * filament used. Shown from the second attempt on; one attempt only repeats
 * the story.
 */
export function BuildSummary({
  attempts,
  photos,
  open,
  onPick,
  selected,
}: {
  /** Oldest first. */
  attempts: AttemptView[];
  /** The build's photos: each attempt's first one is its step in the trail (on phones). */
  photos: Pick<PhotoView, "id" | "attemptId" | "color">[];
  /** The build is still going ("So far"); otherwise it is done or shelved ("In all"). */
  open: boolean;
  onPick: (attemptId: string) => void;
  /** The attempt that is open now. */
  selected?: string | null;
}) {
  const summary = useMemo(() => summarizeBuild(attempts), [attempts]);
  const steps = useMemo(() => {
    const first = new Map<string, Pick<PhotoView, "id" | "color">>();
    for (const photo of photos) if (photo.attemptId && !first.has(photo.attemptId)) first.set(photo.attemptId, photo);
    return attempts.map(({ id, number, outcome, endedAt }) => {
      const photo = first.get(id);
      return {
        id,
        number,
        outcome,
        offBed: isOffTheBed({ outcome, endedAt }),
        photo: photo ? { src: photoSrc(photo.id, "thumb"), color: photo.color || undefined } : null,
      };
    });
  }, [attempts, photos]);
  if (attempts.length < 2) return null;
  const { minutes, grams, filaments } = summary;
  const figures = [
    minutes && `${minutes.approximate ? "about " : ""}${formatMinutes(minutes.value)} of printing`,
    grams && `${grams.atLeast ? "at least " : ""}${Math.round(grams.value)} g of filament`,
  ].filter((figure): figure is string => !!figure);
  return (
    <section aria-label="Summary" className="mt-2 flex flex-col gap-2">
      <Overline as="h2">{open ? "So far" : "In all"}</Overline>
      <p className="text-small text-ink-soft">{summary.words}</p>
      <AttemptTrail attempts={steps} onPick={onPick} selected={selected} className="mt-1 mb-1.5" />
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
