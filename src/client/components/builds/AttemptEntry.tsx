import type { Person } from "@shared/api";
import type { Outcome } from "@shared/attempts";
import { isOffTheBed } from "@shared/print-progress";
import { showsSettings } from "@shared/story-settings";
import { fullTime, relativeTime } from "@shared/time";
import { m } from "motion/react";
import { type ComponentProps, forwardRef, lazy, Suspense } from "react";
import { Avatar, ViaText } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { ChangeLine } from "@/components/ui/ChangeLine";
import { ExpandIcon } from "@/components/ui/icons";
import { OpenLarge, openLarge } from "@/components/ui/OpenLarge";
import { Photo } from "@/components/ui/Photo";
import { PrintProgress } from "@/components/ui/PrintProgress";
import { UploadBadge } from "@/components/ui/UploadBadge";
import { cn } from "@/lib/cn";
import type { AttemptView, ItemView, PhotoView } from "@/lib/items";
import { spring } from "@/lib/motion";
import { photoSrc } from "@/lib/previews";
import { useIsDesktop } from "@/lib/use-media-query";
import { AttemptMenu } from "./AttemptMenu";
import { AttemptTags } from "./AttemptTags";
import { EstimateLine } from "./Estimate";
import { NotEnoughNote } from "./NotEnoughNote";
import { OffTheBed } from "./OffTheBed";
import { OutcomeChip, outcomeDots, stepOf } from "./Outcome";
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
  /**
   * A printing attempt asks "How did it go?" on its card (desktop, with the key's hint). Phones ask it in the page's
   * action bar instead, within thumb reach, so the card only shows how far along it is: one question, never two.
   */
  askOnCard?: boolean;
  /** The keys that ask it too, shown on the card's button ("A"), or after an off-the-bed print's question. */
  askShortcut?: string[];
  /** With an attempt before it: compare the two. */
  onCompare?: () => void;
  /** An attempt that worked and isn't a recipe yet: keep its settings under a name. */
  onSaveRecipe?: () => void;
  /** Offline (or a pending attempt): its model can't be sliced again from here. */
  readOnly?: boolean;
  /** The build it is in: the printer's question and "Not this build?" move it from there. */
  item?: ItemView;
  /** Move it to another build (the "…" menu). */
  onMove?: () => void;
  /**
   * The photo the page leads with (the build's hero). When it is one of this card's, the picture isn't shown large
   * twice: on desktop (the hero sits beside the card) the card's photos are all thumbnails; on a phone the card leads
   * with its first other photo, with the rest (the hero's too) as thumbnails, or only thumbnails when it has no other.
   */
  heroId?: string;
  /** An earlier attempt opened in place from its row: folds it back into the row. */
  onFold?: () => void;
}

/** What opening an attempt's photos large shows: its photos from `start`, its name, how it went, who and when. */
export function attemptLarge(attempt: AttemptView, photos: PhotoView[], person: Person | undefined, start: number) {
  return {
    photos,
    start,
    title: `Attempt ${attempt.number}`,
    badge: <OutcomeChip outcome={attempt.outcome} offTheBed={isOffTheBed(attempt)} />,
    detail: [attempt.fromPrinter ? "From the printer" : person?.name, relativeTime(attempt.printedAt)]
      .filter(Boolean)
      .join(" · "),
  };
}

// Claude's ideas for the next try load after the build page: they only exist for a failed attempt.
const CoachNote = lazy(() => import("./Coach").then((m) => ({ default: m.CoachNote })));
// Which build a print the printer filed belongs to, and where an attempt was moved from (decision 0076).
const PrintPlace = lazy(() => import("./print-place-lazy").then((entry) => entry.loadPrintPlace()));
const PrinterBy = lazy(() => import("./print-place-lazy").then((entry) => entry.loadPrinterBy()));

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
    askOnCard = true,
    askShortcut,
    onCompare,
    onSaveRecipe,
    readOnly,
    item,
    onMove,
    heroId,
    onFold,
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
  const isDesktop = useIsDesktop();
  const holdsHero = !!heroId && photos.some((photo) => photo.id === heroId);
  const thumbsOnly = holdsHero && (isDesktop || photos.length === 1);
  // On a phone the hero is far up the page: lead with a photo it isn't showing.
  const other = holdsHero && !thumbsOnly ? photos.find((photo) => photo.id !== heroId) : undefined;
  const [lead, ...rest] = other ? [other, ...photos.filter((photo) => photo !== other)] : photos;
  const photoLabel = (index: number) =>
    photos.length > 1 ? `Open photo ${index + 1} of ${photos.length} large` : "Open the photo large";
  // Any photo opens large over the page, above the card's own button (which opens the attempt).
  const large = (start: number) => attemptLarge(attempt, photos, person, start);
  const showsDetails =
    filaments.length > 0 ||
    settings.length > 0 ||
    results.length > 0 ||
    (!printing && attempt.settings.estimatedMinutes !== undefined && attempt.settings.actualMinutes !== undefined);

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
            outcomeDots[stepOf(attempt)],
            printing && "animate-pulse",
          )}
        />
      </div>

      <div className="min-w-0 flex-1 pb-4 md:pb-5">
        <div
          className={cn(
            "bg-cream shadow-soft hover:shadow-raised duration-fast relative rounded-lg transition-shadow",
            selected && "shadow-ring",
            // Only for an attempt logged on this device a moment ago (it is still being sent).
            attempt.pending && attempt.outcome && `sg-logged sg-logged-${attempt.outcome}`,
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
                {onFold ? (
                  // Opened from its row: the chip and the name fold it back, the caret where the row has its own.
                  <h3 className="text-body text-ink pointer-events-auto relative z-10 min-w-0 font-sans font-semibold whitespace-nowrap">
                    <button
                      type="button"
                      aria-expanded
                      onClick={onFold}
                      className="pressable focus-ring touch-target relative -m-1 flex items-center gap-2.5 rounded-md p-1"
                    >
                      <OutcomeChip outcome={attempt.outcome} offTheBed={offBed} />
                      Attempt {attempt.number}
                      <ExpandIcon size={16} aria-hidden className="text-ink-faint -ml-1 shrink-0 rotate-180" />
                    </button>
                  </h3>
                ) : (
                  <>
                    <OutcomeChip outcome={attempt.outcome} offTheBed={offBed} />
                    <h3 className="text-body text-ink font-sans font-semibold whitespace-nowrap">
                      Attempt {attempt.number}
                    </h3>
                  </>
                )}
                {/* Wide screens: the time sits on the line. Phones have no room for it beside the avatar and the menu: it goes under. */}
                <span className="text-small text-ink-faint ml-auto flex min-w-0 items-center gap-2 whitespace-nowrap">
                  {!attempt.fromPrinter && <ViaText name={via} person={person?.name} className="hidden md:inline" />}
                  <time
                    dateTime={new Date(attempt.printedAt).toISOString()}
                    title={fullTime(attempt.printedAt)}
                    className="hidden min-w-0 truncate md:inline"
                  >
                    {relativeTime(attempt.printedAt)}
                  </time>
                  {attempt.fromPrinter ? (
                    // The printer's, not whoever paired the bridge; a tap says who started it (decision 0076).
                    <Suspense fallback={<span className="size-6" />}>
                      <PrinterBy
                        attempt={attempt}
                        person={person}
                        itemId={item?.id}
                        readOnly={readOnly}
                        className="pointer-events-auto z-10"
                      />
                    </Suspense>
                  ) : (
                    person && <Avatar person={person} size="xs" via={via} />
                  )}
                </span>
                {/* Above the open button, so it works. */}
                <span className="pointer-events-auto relative z-10 -my-1.5 flex shrink-0">
                  <AttemptMenu
                    number={attempt.number}
                    onCompare={onCompare}
                    onSaveRecipe={onSaveRecipe}
                    onMove={onMove}
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

            {item && (attempt.print?.asking || attempt.print?.reasons.length || attempt.moved) && (
              // Above the open button, so its offers and links work.
              <Suspense fallback={null}>
                <PrintPlace item={item} attempt={attempt} where="entry" className="pointer-events-auto relative z-10" />
              </Suspense>
            )}

            <ChangeLine changes={attempt.changes} label={`Changed since attempt ${attempt.number - 1}: `} />

            {attempt.note && <p className="text-lead md:text-body text-ink break-words">{attempt.note}</p>}

            {thumbsOnly ? (
              // The page already leads with one of these photos: here they are all thumbnails, each once.
              <div className="flex gap-2">
                {photos.slice(0, 4).map((photo, index) => (
                  <EntryPhoto
                    key={photo.id}
                    photo={photo}
                    alt={`Attempt ${attempt.number}${index ? `, photo ${index + 1}` : ""}`}
                    label={photoLabel(index)}
                    className="size-16 flex-none md:size-24"
                    more={index === 3 && photos.length > 4 ? photos.length - 4 : 0}
                    onClick={(event) => openLarge(event, large(index))}
                  />
                ))}
              </div>
            ) : (
              lead && (
                // The lead photo fills the card, as large as a print deserves; any more are small thumbnails under
                // it (prints are physical, and a sliver of a second photo reads as cropped, not as more).
                <div className="flex flex-col gap-2">
                  <EntryPhoto
                    photo={lead}
                    alt={`Attempt ${attempt.number}`}
                    // Not "Attempt 1 …": the card's own button is the one named after the attempt.
                    label={photoLabel(photos.indexOf(lead))}
                    variant="large"
                    className="aspect-4/3 w-full md:aspect-3/2"
                    onClick={(event) => openLarge(event, large(photos.indexOf(lead)))}
                  />
                  {rest.length > 0 && (
                    <div className="flex gap-2">
                      {rest.slice(0, 4).map((photo, index) => (
                        <EntryPhoto
                          key={photo.id}
                          photo={photo}
                          alt={`Attempt ${attempt.number}, photo ${photos.indexOf(photo) + 1}`}
                          label={photoLabel(photos.indexOf(photo))}
                          className="size-16 flex-none md:size-20"
                          more={index === 3 && rest.length > 4 ? rest.length - 4 : 0}
                          onClick={(event) => openLarge(event, large(photos.indexOf(photo)))}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )
            )}

            <AttemptTags attempt={attempt} />

            {/* The story ends with the tags; the file, how long it took and the settings are the details under it. */}
            {(attempt.file || showsDetails) && (
              <div
                className={cn(
                  "relative flex flex-col gap-3",
                  // Right under the printer's question, its wash is edge enough: no rule between the two.
                  attempt.print?.asking &&
                    !attempt.note &&
                    !lead &&
                    !attempt.changes.length &&
                    !attempt.failureTags.length &&
                    !attempt.successNotes.length
                    ? "pt-0.5"
                    : "before:bg-hairline pt-3.5 before:absolute before:top-0 before:right-0 before:left-0 before:h-px",
                )}
              >
                {attempt.file && (
                  // Above the open button, so its controls work; the card's width, so the download lines up with the
                  // attempt's menu above it. Between its controls a tap still opens the attempt.
                  <div className="relative z-10 [&_a]:pointer-events-auto [&_button]:pointer-events-auto">
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
                    <EstimateLine
                      estimated={attempt.settings.estimatedMinutes}
                      actual={attempt.settings.actualMinutes}
                    />
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
              </div>
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
                shortcut={askShortcut}
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
                {askOnCard && (
                  // The page's one way to log this print, so it is its primary action (Today and the Journal's Now ask
                  // the same question in the same words).
                  <Button
                    size="sm"
                    variant="primary"
                    shortcut={askShortcut}
                    onClick={() => onFinish()}
                    className="ml-auto"
                  >
                    How did it go?
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </m.li>
  );
});

/** One of the card's photos: a button above the card's own, that opens it large. */
function EntryPhoto({
  photo,
  alt,
  label,
  className,
  more = 0,
  variant = "thumb",
  ...opens
}: {
  photo: PhotoView;
  alt: string;
  label: string;
  className?: string;
  more?: number;
  variant?: "thumb" | "large";
} & Omit<ComponentProps<typeof OpenLarge>, "label" | "className">) {
  return (
    <OpenLarge
      label={label}
      className={cn("pointer-events-auto relative z-10 rounded-md", className)}
      data-photo-id={photo.id}
      {...opens}
    >
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
    </OpenLarge>
  );
}
