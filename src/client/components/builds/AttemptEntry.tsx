import type { Person } from "@shared/api";
import type { Outcome } from "@shared/attempts";
import { isOffTheBed } from "@shared/print-progress";
import { showsSettings } from "@shared/story-settings";
import { fullTime, relativeTime } from "@shared/time";
import { m } from "motion/react";
import { forwardRef, lazy, Suspense } from "react";
import { Avatar, ViaText } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { SameAgainIcon } from "@/components/ui/icons";
import { MetaList } from "@/components/ui/MetaList";
import { Photo } from "@/components/ui/Photo";
import { PrintProgress } from "@/components/ui/PrintProgress";
import { UploadBadge } from "@/components/ui/UploadBadge";
import { cn } from "@/lib/cn";
import type { AttemptView, PhotoView } from "@/lib/items";
import { spring } from "@/lib/motion";
import { photoSrc } from "@/lib/previews";
import { AttemptMenu } from "./AttemptMenu";
import { AttemptTags } from "./AttemptTags";
import { EstimateLine } from "./Estimate";
import { NotEnoughNote } from "./NotEnoughNote";
import { OffTheBed } from "./OffTheBed";
import { OutcomeChip, outcomeDots } from "./Outcome";
import { SettingsLine } from "./SettingsLine";
import { SavedFileCard } from "./SlicerFile";
import { filamentLabel, summarizeResults, summarizeSettings } from "./settings";

interface AttemptEntryProps {
  attempt: AttemptView;
  /** What it printed of the build's parts: "Hull half ×2, Deck". */
  partsLabel?: string | null;
  photos: PhotoView[];
  /** A photo of the print from its "how did it go?" (the camera on phones), while it has none. */
  onPhotos?: (files: File[]) => void;
  person?: Person;
  /** The agent it was logged through. */
  via?: string;
  /** Highlighted by the arrow keys on desktop. */
  selected?: boolean;
  /** The newest entry: the timeline's line stops above the first one. */
  first?: boolean;
  last?: boolean;
  onOpen: () => void;
  /** For a printing attempt, or one that is off the bed: open it to finish it (with the outcome, if one was picked). */
  onFinish?: (outcome?: Outcome) => void;
  /** With an attempt before it: compare the two. */
  onCompare?: () => void;
  /** An attempt that worked and isn't a recipe yet: keep its settings under a name. */
  onSaveRecipe?: () => void;
  /** Some entry of this build has more photos: keep their column's room free in every entry, so the lead photos match. */
  reserveExtras?: boolean;
  /** Offline (or a pending attempt): its model can't be sliced again from here. */
  readOnly?: boolean;
}

// Claude's ideas for the next try load after the build page: they only exist for a failed attempt.
const CoachNote = lazy(() => import("./Coach").then((m) => ({ default: m.CoachNote })));

/**
 * One attempt in a build's story: how it went, what was tried differently
 * from the attempt before, its photos (large: prints are physical), tags,
 * and the settings in a line. Tapping it opens the attempt.
 */
export const AttemptEntry = forwardRef<HTMLLIElement, AttemptEntryProps>(function AttemptEntry(
  {
    attempt,
    partsLabel,
    photos,
    onPhotos,
    person,
    via,
    selected,
    first,
    last,
    onOpen,
    onFinish,
    onCompare,
    onSaveRecipe,
    reserveExtras,
    readOnly,
  },
  ref,
) {
  const offBed = isOffTheBed(attempt);
  // Still on the bed: printing, as far as anyone knows. Off it, and waiting for a verdict, is a state of its own.
  const printing = attempt.outcome === null && !offBed;
  // The settings repeat from one attempt to the next: see `showsSettings` for where the story lists them.
  const showSettings = showsSettings(attempt);
  const settings = showSettings ? summarizeSettings(attempt.settings) : [];
  const results = summarizeResults(attempt.settings);
  const filaments = attempt.settings.filaments ?? [];
  const [lead, ...rest] = photos;

  return (
    <m.li
      ref={ref}
      layout="position"
      initial={attempt.pending ? { opacity: 0, y: -10 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={spring.gentle}
      className="relative flex list-none gap-3.5 md:gap-4"
      aria-current={selected || undefined}
      data-attempt-id={attempt.id}
    >
      {/* The thread of the story: a dot in the outcome's color on a quiet line. */}
      <div className="relative flex w-3 shrink-0 justify-center" aria-hidden>
        <span className={cn("bg-ink/10 absolute w-0.5", first ? "top-6" : "top-0", last ? "h-6" : "bottom-0")} />
        <span
          className={cn(
            "ring-paper relative mt-5 size-3 rounded-full ring-4",
            outcomeDots[attempt.outcome ?? (offBed ? "offBed" : "printing")],
            printing && "animate-pulse",
          )}
        />
      </div>

      <div className="min-w-0 flex-1 pb-4 md:pb-5">
        <div
          className={cn(
            "bg-cream shadow-soft hover:shadow-raised duration-fast relative rounded-lg transition-shadow",
            selected && "shadow-ring",
          )}
        >
          <button
            type="button"
            onClick={onOpen}
            aria-label={`Attempt ${attempt.number}: ${printing ? "printing" : offBed ? "off the bed" : attempt.outcome}. Open`}
            className="focus-ring absolute inset-0 z-0 rounded-lg"
          />
          <div className="pointer-events-none relative flex flex-col gap-3 p-3.5 md:p-4">
            <div className="-mb-1 flex flex-col gap-1.5">
              <div className="flex items-center gap-2.5">
                <OutcomeChip outcome={attempt.outcome} offTheBed={offBed} />
                <h3 className="text-body text-ink font-sans font-semibold whitespace-nowrap">
                  Attempt {attempt.number}
                </h3>
                {/* Wide screens: the time sits on the line. Phones have no room for it beside the avatar and the menu: it goes under. */}
                <span className="text-small text-ink-faint ml-auto flex min-w-0 items-center gap-2 whitespace-nowrap">
                  <ViaText name={via} className="hidden md:inline" />
                  <time
                    dateTime={new Date(attempt.printedAt).toISOString()}
                    title={fullTime(attempt.printedAt)}
                    className="hidden min-w-0 truncate md:inline"
                  >
                    {relativeTime(attempt.printedAt)}
                  </time>
                  {person && <Avatar person={person} size="xs" via={via} />}
                </span>
                {/* Above the open button, so it works. */}
                <span className="pointer-events-auto relative z-10 -my-1.5 flex shrink-0">
                  <AttemptMenu
                    number={attempt.number}
                    onCompare={onCompare}
                    onSaveRecipe={onSaveRecipe}
                    changed={attempt.changes.length > 0}
                  />
                </span>
              </div>
              <p className="text-small text-ink-faint -mt-0.5 md:hidden">
                <time dateTime={new Date(attempt.printedAt).toISOString()} title={fullTime(attempt.printedAt)}>
                  {relativeTime(attempt.printedAt)}
                </time>
              </p>
              {partsLabel && (
                <p className="text-small text-ink-soft" data-testid="attempt-parts">
                  {partsLabel}
                </p>
              )}
            </div>

            {attempt.changes.length > 0 && (
              <p className="text-small text-ink-soft flex items-start gap-1.5">
                <SameAgainIcon size={16} className="text-semolina-ink mt-0.5 shrink-0" aria-hidden />
                <span className="sr-only">Changed since attempt {attempt.number - 1}: </span>
                <ChangeChips attempt={attempt} className="flex-1" />
              </p>
            )}

            {attempt.note && <p className="text-body text-ink break-words">{attempt.note}</p>}

            {lead && (
              // On desktop the lead is the same size in every entry (4:3, at most md); any more photos
              // are a narrow column beside it, as tall as the lead, so the pictures line up down the story.
              <div className="flex gap-2">
                <EntryPhoto
                  photo={lead}
                  alt={`Attempt ${attempt.number}`}
                  variant="large"
                  className="aspect-4/3 min-w-0 flex-3 md:max-w-md md:flex-1"
                />
                {rest.length === 0 && reserveExtras && (
                  <div className="hidden md:block md:w-32 md:flex-none" aria-hidden />
                )}
                {rest.length > 0 && (
                  <div className="flex min-w-0 flex-1 flex-col gap-2 md:w-32 md:flex-none">
                    {rest.slice(0, 2).map((photo, index) => (
                      <EntryPhoto
                        key={photo.id}
                        photo={photo}
                        alt={`Attempt ${attempt.number}, photo ${index + 2}`}
                        className="min-h-0 flex-1"
                        more={index === 1 && rest.length > 2 ? rest.length - 2 : 0}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            <AttemptTags attempt={attempt} />

            {attempt.file && (
              // Above the open button, so its download link works.
              <div className="pointer-events-auto relative z-10 md:max-w-md">
                <SavedFileCard
                  compact
                  file={attempt.file}
                  owner={readOnly ? undefined : { itemId: attempt.itemId, attemptId: attempt.id }}
                  filaments={attempt.settings.filaments}
                  printing={attempt.outcome === null && attempt.endedAt === null ? { id: attempt.id } : undefined}
                />
              </div>
            )}

            {!printing &&
              attempt.settings.estimatedMinutes !== undefined &&
              attempt.settings.actualMinutes !== undefined && (
                <EstimateLine estimated={attempt.settings.estimatedMinutes} actual={attempt.settings.actualMinutes} />
              )}

            {(filaments.length > 0 || settings.length > 0 || results.length > 0) && (
              <SettingsLine
                filaments={filaments}
                parts={[...settings, ...results]}
                name={(filament) =>
                  [filament.colorName, filament.type].filter(Boolean).join(" ") || filamentLabel(filament)
                }
                className="text-small text-ink-faint"
                filamentClassName="text-ink-soft"
              />
            )}

            {attempt.coach && (
              // Above the open button, so its dismiss buttons work.
              <Suspense fallback={null}>
                <CoachNote
                  coach={attempt.coach}
                  itemId={attempt.itemId}
                  attemptId={attempt.id}
                  className="pointer-events-auto relative z-10"
                />
              </Suspense>
            )}

            {printing && <NotEnoughNote settings={attempt.settings} what="this print" />}

            {offBed && attempt.endedAt !== null && (
              <OffTheBed
                endedAt={attempt.endedAt}
                onPick={onFinish}
                photoRead={attempt.photoRead}
                onPhotos={photos.length ? undefined : onPhotos}
                className="pointer-events-auto"
              />
            )}

            {printing && onFinish && (
              <div className="pointer-events-auto flex items-center gap-3">
                <PrintProgress
                  startedAt={attempt.printedAt}
                  estimatedMinutes={attempt.settings.estimatedMinutes}
                  attemptId={attempt.id}
                  className="flex-1"
                />
                <Button size="sm" variant="secondary" onClick={() => onFinish()} className="ml-auto">
                  Finish
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </m.li>
  );
});

function EntryPhoto({
  photo,
  alt,
  className,
  more = 0,
  variant = "thumb",
}: {
  photo: PhotoView;
  alt: string;
  className?: string;
  more?: number;
  variant?: "thumb" | "large";
}) {
  return (
    <div className={cn("relative overflow-hidden rounded-md", className)}>
      <Photo src={photoSrc(photo.id, variant)} alt={alt} color={photo.color || undefined} className="size-full" />
      {photo.upload && (
        <UploadBadge
          state={photo.upload.status === "queued" ? "queued" : photo.upload.status}
          progress={photo.upload.progress}
          className="absolute bottom-2 left-2"
        />
      )}
      {more > 0 && (
        <span className="bg-veil text-title text-on-veil absolute inset-0 flex items-center justify-center font-semibold">
          +{more}
        </span>
      )}
    </div>
  );
}

function ChangeChips({ attempt, className }: { attempt: AttemptView; className?: string }) {
  return (
    <MetaList className={className}>
      {attempt.changes.map((change) => (
        <span
          key={change.key}
          className="bg-semolina-soft/70 text-ink max-w-full rounded-xs px-1 font-medium whitespace-nowrap"
        >
          {change.text}
        </span>
      ))}
    </MetaList>
  );
}
