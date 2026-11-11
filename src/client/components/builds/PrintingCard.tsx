import type { Person } from "@shared/api";
import type { Outcome } from "@shared/attempts";
import { attemptPartsLabel } from "@shared/parts";
import { isOffTheBed } from "@shared/print-progress";
import { Link, useNavigate } from "@tanstack/react-router";
import { m, useReducedMotion } from "motion/react";
import { useRef } from "react";
import { Avatar, ViaText } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { MetaList } from "@/components/ui/MetaList";
import { NoteFace } from "@/components/ui/NoteFace";
import { Photo } from "@/components/ui/Photo";
import { PrintProgress } from "@/components/ui/PrintProgress";
import { heroPhoto } from "@/lib/builds";
import { cn } from "@/lib/cn";
import type { AttemptView, ItemView } from "@/lib/items";
import { duration } from "@/lib/motion";
import { fileThumbSrc, photoSrc } from "@/lib/previews";
import { usePrintProgress } from "@/lib/print-progress";
import { itemName } from "../journal/JournalEntry";
import { OffTheBed } from "./OffTheBed";
import { OutcomeChip, OutcomePicker } from "./Outcome";
import { SettingsLine } from "./SettingsLine";

interface PrintingCardProps {
  item: ItemView;
  /** The attempt that is on the bed (its outcome is null). */
  attempt: AttemptView;
  /** Who started it. */
  person?: Person;
  via?: string;
  /**
   * Phones only: a small square picture beside the name instead of the big one on top, for the prints after
   * the first, so three prints on the bed don't push the rest of Today two screens down. Desktop is unchanged.
   */
  compact?: boolean;
}

/** The card's grid on phones, big or compact; from md both are the same row: picture on two fifths, text beside. */
const layouts = {
  big: { card: "grid-cols-1", picture: "aspect-4/3", head: "px-2 pt-2.5", body: "px-2 pt-2.5 pb-2" },
  compact: {
    card: "grid-cols-[auto_minmax(0,1fr)]",
    picture: "size-24 self-start",
    head: "pt-1 pr-2 pl-3",
    body: "col-span-2 px-2 pt-3 pb-2",
  },
} as const;

/**
 * A print on the bed, big and warm: the build's picture, its name in Fraunces (the one card title that is,
 * because this is the screen's focal point), how far along it is, and a way to finish it. The card leads to
 * the build; Finish goes to the build with the attempt's sheet open. When the print should be done, the button
 * gives way to the question people came to answer: how did it go?
 */
export function PrintingCard({ item, attempt, person, via, compact = false }: PrintingCardProps) {
  const layout = layouts[compact ? "compact" : "big"];
  // Whether it changed size since it first showed: only then does the new layout fade in.
  const firstCompact = useRef(compact);
  const changed = firstCompact.current !== compact;
  const reduce = useReducedMotion();
  const navigate = useNavigate();
  const offBed = isOffTheBed(attempt);
  const progress = usePrintProgress(attempt.id, attempt.printedAt, attempt.settings.estimatedMinutes);
  const due = progress.state === "due";
  const hero = heroPhoto(item);
  const plate = !hero && attempt.file?.hasThumb ? attempt.file : undefined;
  const name = itemName(item);
  const partsLabel = attemptPartsLabel(attempt, item.parts);
  const filaments = attempt.settings.filaments ?? [];

  const finish = (outcome?: Outcome) =>
    void navigate({
      to: "/builds/$buildId",
      params: { buildId: item.id },
      search: { attempt: attempt.id, finish: outcome ?? "1" },
    });

  return (
    // On Today a compact card that becomes the first turns into the big one: Today's AutoHeight grows the box, and
    // the new layout fades in here (the compact one leaves at once), so nothing slides through anything.
    <article className="bg-cream shadow-soft hover:shadow-raised hover:bg-lifted duration-fast relative rounded-lg p-1.5 transition-shadow">
      {/* The whole card leads to the build; what is inside that can be pressed sits above it. */}
      <Link
        to="/builds/$buildId"
        params={{ buildId: item.id }}
        search={{ attempt: attempt.id }}
        className="focus-ring absolute inset-0 z-0 rounded-lg"
      >
        <span className="sr-only">
          {name.text}, attempt {attempt.number}
          {partsLabel ? `, ${partsLabel}` : ""}
        </span>
      </Link>
      <m.div
        key={compact ? "compact" : "big"}
        initial={changed && !reduce ? { opacity: 0 } : false}
        animate={{ opacity: 1, transition: { duration: duration.base } }}
        className={cn("grid md:grid-cols-5 md:grid-rows-[auto_1fr]", layout.card)}
      >
        <div
          className={cn(
            "pointer-events-none relative overflow-hidden rounded-md md:col-span-2 md:row-span-2 md:aspect-4/3 md:h-auto md:w-full md:self-stretch",
            layout.picture,
          )}
        >
          {hero ? (
            <Photo src={photoSrc(hero.id, "thumb")} alt="" color={hero.color || undefined} className="size-full" />
          ) : plate ? (
            <Photo
              src={fileThumbSrc(plate.id)}
              alt=""
              fit="contain"
              className={cn("size-full", compact ? "p-1 md:p-3" : "p-3")}
            />
          ) : (
            <NoteFace note={name.text} />
          )}
          {/* On a compact card the words under it say the same, and a chip would cover the small picture. */}
          <OutcomeChip
            outcome={null}
            offTheBed={offBed}
            className={cn("shadow-soft absolute bottom-2 left-2", compact && "max-md:hidden")}
          />
        </div>
        <div
          className={cn(
            "pointer-events-none relative flex min-w-0 flex-col md:col-span-3 md:px-4 md:pt-3",
            compact ? "gap-1.5 md:gap-2.5" : "gap-2.5",
            layout.head,
          )}
        >
          <div className="flex items-start gap-3">
            <h3
              className={cn(
                "font-display text-ink line-clamp-2 min-w-0 flex-1 break-words",
                compact ? "text-lead md:text-title" : "text-title",
              )}
            >
              {name.text}
            </h3>
            {person && (
              <span className="mt-1.5 flex shrink-0 items-center gap-2">
                <ViaText name={via} className="hidden md:inline" />
                <Avatar person={person} size="xs" via={via} />
              </span>
            )}
          </div>
          <MetaList className="text-small text-ink-faint">
            <span className="whitespace-nowrap">attempt {attempt.number}</span>
            {partsLabel && <span>{partsLabel}</span>}
            {filaments.length > 0 && (
              <SettingsLine
                filaments={filaments}
                parts={[]}
                name={(filament) => [filament.colorName, filament.type].filter(Boolean).join(" ") || "Filament"}
                className="inline-flex flex-wrap"
              />
            )}
          </MetaList>
        </div>
        <div
          className={cn(
            "pointer-events-none relative flex min-w-0 flex-col gap-2.5 md:col-span-3 md:px-4 md:pt-2.5 md:pb-3",
            layout.body,
          )}
        >
          {offBed && attempt.endedAt !== null ? (
            // The printer says it stopped: no bar to draw, only the calm question and the three answers.
            <OffTheBed
              endedAt={attempt.endedAt}
              onPick={(outcome) => finish(outcome)}
              className="pointer-events-auto md:mt-auto"
            />
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                <PrintProgress
                  startedAt={attempt.printedAt}
                  estimatedMinutes={attempt.settings.estimatedMinutes}
                  attemptId={attempt.id}
                  showLabel={false}
                />
                <div className="flex items-center justify-between gap-3">
                  <p
                    className={cn(
                      "text-small tabular min-w-0",
                      progress.state === "due" ? "text-semolina-ink font-semibold" : "text-ink-soft",
                    )}
                  >
                    {progress.label}
                  </p>
                  {!due && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => finish()}
                      className="pointer-events-auto shrink-0"
                    >
                      Finish
                    </Button>
                  )}
                </div>
              </div>
              {due && (
                <div className="pointer-events-auto flex flex-col gap-2 md:mt-auto">
                  <p className="text-body text-ink font-semibold">How did it go?</p>
                  <OutcomePicker value={null} onChange={(outcome) => finish(outcome)} size="md" />
                </div>
              )}
            </>
          )}
        </div>
      </m.div>
    </article>
  );
}
