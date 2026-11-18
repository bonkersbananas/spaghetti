import { type AttemptSettings, carryOver, describeChanges } from "@shared/attempts";
import { inlineTime } from "@shared/time";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, m } from "motion/react";
import { Fragment } from "react";
import { Button } from "@/components/ui/Button";
import { BuildsIcon, CheckIcon, UndoIcon, WorkedIcon } from "@/components/ui/icons";
import { MetaList } from "@/components/ui/MetaList";
import { Overline } from "@/components/ui/Overline";
import { Photo } from "@/components/ui/Photo";
import { duration, ease } from "@/lib/motion";
import { photoSrc } from "@/lib/previews";
import { whatWorkedQuery } from "@/lib/search";
import { useIsDesktop } from "@/lib/use-media-query";
import { SettingsLine } from "./SettingsLine";
import { filamentLabel, summarizeSettings } from "./settings";

interface WhatWorkedSuggestionProps {
  itemId: string;
  /** The settings the new attempt starts from now. */
  settings: AttemptSettings;
  onUse: (settings: AttemptSettings) => void;
  /** Which match was used and the settings from before it, kept by the sheet: they outlive this card when its row closes. */
  used: { id: string; before: AttemptSettings } | null;
  onUsed: (used: { id: string; before: AttemptSettings } | null) => void;
}

/**
 * "What worked last time": the latest attempt that came out right with the
 * same material (this build's own first), with its photo and key settings,
 * and one tap to start from them. It stays out of the way when there is
 * nothing to offer, or when the attempt already starts from those settings.
 */
export function useWhatWorked(itemId: string, settings: AttemptSettings) {
  const material = settings.filaments?.find((filament) => filament.type?.trim())?.type?.trim();
  const { data: matches } = useQuery(whatWorkedQuery(itemId, material));
  const best = matches?.[0];
  // Its settings, on the spool already chosen (same material; the color is this print's own).
  const suggested = best
    ? {
        ...carryOver(best.attempt.settings),
        ...(settings.filaments?.length ? { filaments: settings.filaments.map((filament) => ({ ...filament })) } : {}),
      }
    : undefined;
  const changes = suggested ? describeChanges(settings, suggested) : [];
  return { matches, best, suggested, changes, offers: !!best && changes.length > 0 };
}

/** One line for the closed settings row: what worked, where, and the settings that did ("Worked on Hook: Textured PEI, 250 °C"). */
export function offerLine(match: NonNullable<ReturnType<typeof useWhatWorked>["best"]>): string {
  const where = match.sameBuild ? `attempt ${match.number}` : match.item.title?.trim() || "another build";
  const settings = summarizeSettings(match.attempt.settings).slice(0, 1).join(", ");
  return `Worked ${match.sameBuild ? "in" : "on"} ${where}${settings ? `: ${settings}` : ""}`;
}

export function WhatWorkedSuggestion({ itemId, settings, onUse, used, onUsed }: WhatWorkedSuggestionProps) {
  const { matches, best, suggested, changes } = useWhatWorked(itemId, settings);
  const isDesktop = useIsDesktop();

  const usedMatch = used && matches?.find((match) => match.attempt.id === used.id);
  const show = usedMatch ?? (best && changes.length > 0 ? best : null);
  if (!show) return null;

  const where = show.sameBuild ? `Attempt ${show.number}` : show.item.title?.trim() || "Another build";
  const parts = summarizeSettings(show.attempt.settings).slice(0, 4);
  return (
    <AnimatePresence initial={false}>
      <m.section
        key={show.attempt.id}
        aria-label="What worked last time"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: duration.base, ease: ease.out }}
        className="bg-basil-soft/60 flex flex-col gap-3 rounded-lg p-3"
      >
        <div className="flex gap-3">
          {show.photo ? (
            <Photo
              src={photoSrc(show.photo.id, "thumb")}
              alt={`${where}, the print that worked`}
              color={show.photo.color || undefined}
              className="size-16 shrink-0 rounded-md"
            />
          ) : (
            <span className="bg-cream/70 text-basil-ink flex size-16 shrink-0 items-center justify-center rounded-md">
              <BuildsIcon size={24} aria-hidden />
            </span>
          )}
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <Overline tone="basil" className="flex items-center gap-1">
              <WorkedIcon size={14} weight="fill" aria-hidden />
              Worked last time
            </Overline>
            <MetaList className="text-small">
              <span className="text-ink font-semibold">{where}</span>
              <span className="text-ink-faint font-medium whitespace-nowrap">{inlineTime(show.attempt.printedAt)}</span>
            </MetaList>
            <SettingsLine
              filaments={show.attempt.settings.filaments ?? []}
              parts={parts}
              name={filamentLabel}
              className="text-small text-ink-soft"
              filamentClassName="text-ink"
            />
          </div>
        </div>
        {usedMatch && used ? (
          <div className="flex items-center gap-2">
            <span className="text-small text-basil-ink flex flex-1 items-center gap-1.5 font-semibold">
              <CheckIcon size={16} weight="bold" aria-hidden />
              Starting from these settings
            </span>
            <Button
              variant="quiet"
              size="sm"
              icon={UndoIcon}
              onClick={() => {
                onUse(used.before);
                onUsed(null);
              }}
            >
              Undo
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5 md:flex-row md:items-center">
            <p className="text-small text-ink-soft min-w-0 flex-1">
              <span className="sr-only">It would change: </span>
              {changes.slice(0, 4).map((change, index) => (
                <Fragment key={change.key}>
                  {index > 0 && ", "}
                  <span className="whitespace-nowrap">{change.text}</span>
                </Fragment>
              ))}
              {changes.length > 4 && `, and ${changes.length - 4} more`}
            </p>
            <Button
              variant="secondary"
              size={isDesktop ? "sm" : "md"}
              onClick={() => {
                if (!suggested) return;
                onUsed({ id: show.attempt.id, before: settings });
                onUse(suggested);
              }}
              className="max-md:w-full"
            >
              Use these settings
            </Button>
          </div>
        )}
      </m.section>
    </AnimatePresence>
  );
}
