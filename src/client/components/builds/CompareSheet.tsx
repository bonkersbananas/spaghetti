import { OUTCOME_LABELS } from "@shared/attempts";
import { relativeTime } from "@shared/time";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { type PointerEvent, useRef, useState } from "react";
import { ExpandIcon, ImageIcon } from "@/components/ui/icons";
import { Photo } from "@/components/ui/Photo";
import { PhotoThumb } from "@/components/ui/PhotoTiles";
import { Popover, PopoverClose } from "@/components/ui/Popover";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Sheet } from "@/components/ui/Sheet";
import { cn } from "@/lib/cn";
import type { AttemptView, ItemView, PhotoView } from "@/lib/items";
import { duration, ease } from "@/lib/motion";
import { photoSrc } from "@/lib/previews";
import { itemName } from "@/lib/recent";
import { useIsDesktop } from "@/lib/use-media-query";
import { AttemptTags } from "./AttemptTags";
import { CompareTable } from "./CompareTable";
import { OutcomeChip, outcomeDots } from "./Outcome";

/** Two attempts of one build by id; the older one is always on the left. */
export interface ComparePair {
  older: string;
  newer: string;
}

interface CompareSheetProps {
  item: ItemView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pair: ComparePair | null;
  /** Desktop: a picker swapped one of the two attempts. */
  onPairChange: (pair: ComparePair) => void;
}

/**
 * Two attempts of a build side by side, to answer the question the app exists
 * for: did it help? A wide dialog on desktop (a column each, a picker on each
 * header, uncropped photos, then what changed, what stayed and how it went);
 * a full-height sheet on phones (one photo at a time under a switch, a swipe
 * moves between the two, and the same table below).
 */
export function CompareSheet({ item, open, onOpenChange, pair, onPairChange }: CompareSheetProps) {
  const isDesktop = useIsDesktop();
  const older = item.attempts.find((attempt) => attempt.id === pair?.older);
  const newer = item.attempts.find((attempt) => attempt.id === pair?.newer);
  return (
    <Sheet
      open={open && !!older && !!newer}
      onOpenChange={onOpenChange}
      title={older && newer ? `Attempt ${older.number} and attempt ${newer.number}` : "Compare attempts"}
      description={itemName(item, "build")}
      wide
      tall
    >
      {older && newer ? (
        isDesktop ? (
          <DesktopCompare item={item} older={older} newer={newer} onPairChange={onPairChange} />
        ) : (
          <PhoneCompare item={item} older={older} newer={newer} />
        )
      ) : null}
    </Sheet>
  );
}

const photosOf = (item: ItemView, attempt: AttemptView): PhotoView[] =>
  item.photos.filter((photo) => photo.attemptId === attempt.id);

/** The lead photo of an attempt, whole (these are prints people study, never cropped); more of them as a row of thumbnails that pick. */
function AttemptPhotos({
  attempt,
  photos,
  picked,
  onPick,
  fade = false,
  reserveThumbs = false,
}: {
  attempt: AttemptView;
  photos: PhotoView[];
  picked: string | undefined;
  onPick: (photoId: string) => void;
  /** Crossfade when the attempt changes (the phone's switch). */
  fade?: boolean;
  /** The other attempt has a row of thumbnails: keep its height here, so the notes below start level. */
  reserveThumbs?: boolean;
}) {
  const reduce = useReducedMotion();
  const shown = photos.find((photo) => photo.id === picked) ?? photos[0];
  const frame = (
    <>
      {shown ? (
        <Photo
          src={photoSrc(shown.id, "large")}
          alt={`Attempt ${attempt.number}`}
          color={shown.color || undefined}
          fit="contain"
          eager
          frame="deep"
          className="size-full"
        />
      ) : (
        <div className="bg-well text-ink-faint text-small flex size-full flex-col items-center justify-center gap-1.5">
          <ImageIcon size={28} weight="light" aria-hidden />
          No photo
        </div>
      )}
    </>
  );
  return (
    <div className="flex flex-col gap-2.5">
      <div className="bg-paper-deep relative aspect-4/3 overflow-hidden rounded-md">
        {fade ? (
          <AnimatePresence initial={false}>
            <m.div
              key={`${attempt.id}-${shown?.id ?? "none"}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              // Crossfades in place over duration.fast; with reduced motion the photo simply swaps.
              transition={{ duration: reduce ? 0 : duration.fast, ease: ease.out }}
              className="absolute inset-0"
            >
              {frame}
            </m.div>
          </AnimatePresence>
        ) : (
          frame
        )}
      </div>
      {photos.length <= 1 && reserveThumbs && <div className="size-16" aria-hidden />}
      {photos.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {photos.map((photo, index) => (
            <PhotoThumb
              key={photo.id}
              size="sm"
              src={photoSrc(photo.id, "thumb")}
              alt={`Attempt ${attempt.number}, photo ${index + 1}`}
              color={photo.color || undefined}
              selected={photo.id === shown?.id}
              onSelect={() => onPick(photo.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** What was written about an attempt: its note, then its tags as in the story. */
function AttemptWords({ attempt }: { attempt: AttemptView }) {
  return (
    <div className="flex flex-col gap-2.5">
      {attempt.note && <p className="text-body text-ink break-words">{attempt.note}</p>}
      <AttemptTags attempt={attempt} />
    </div>
  );
}

const when = (attempt: AttemptView) => relativeTime(attempt.printedAt);

/** Photo choices are remembered per attempt for as long as the sheet is open. */
function usePickedPhotos() {
  const [picked, setPicked] = useState<Record<string, string>>({});
  return [
    picked,
    (attemptId: string, photoId: string) => setPicked((current) => ({ ...current, [attemptId]: photoId })),
  ] as const;
}

function DesktopCompare({
  item,
  older,
  newer,
  onPairChange,
}: {
  item: ItemView;
  older: AttemptView;
  newer: AttemptView;
  onPairChange: (pair: ComparePair) => void;
}) {
  const [picked, pick] = usePickedPhotos();
  const swap = (column: "older" | "newer", id: string) => {
    const other = column === "older" ? newer : older;
    const chosen = item.attempts.find((attempt) => attempt.id === id);
    if (!chosen || chosen.id === other.id) return;
    // The older attempt always sits on the left.
    const [a, b] = chosen.number < other.number ? [chosen, other] : [other, chosen];
    onPairChange({ older: a.id, newer: b.id });
  };
  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-2 gap-4 md:gap-6">
        {(
          [
            ["older", older, newer],
            ["newer", newer, older],
          ] as const
        ).map(([column, attempt, other]) => (
          <div key={column} className="flex min-w-0 flex-col gap-3">
            <div className="flex items-center gap-2.5">
              <OutcomeChip outcome={attempt.outcome} />
              <AttemptPicker item={item} attempt={attempt} other={other} onPick={(id) => swap(column, id)} />
              <span className="text-small text-ink-faint ml-auto shrink-0">{when(attempt)}</span>
            </div>
            <AttemptPhotos
              attempt={attempt}
              photos={photosOf(item, attempt)}
              picked={picked[attempt.id]}
              onPick={(photoId) => pick(attempt.id, photoId)}
              reserveThumbs={photosOf(item, other).length > 1}
            />
            <AttemptWords attempt={attempt} />
          </div>
        ))}
      </div>
      <CompareTable older={older} newer={newer} />
    </div>
  );
}

/** The attempt's name as a button that lists every attempt of the build; picking one swaps this column. */
function AttemptPicker({
  item,
  attempt,
  other,
  onPick,
}: {
  item: ItemView;
  attempt: AttemptView;
  other: AttemptView;
  onPick: (attemptId: string) => void;
}) {
  return (
    <Popover
      label={`Pick the attempt to compare`}
      side="bottom"
      align="start"
      className="w-64 p-2"
      trigger={
        <button
          type="button"
          className="focus-ring pressable text-body text-ink hover:bg-ink/4 -ml-1.5 inline-flex min-h-8 items-center gap-1 rounded-md px-1.5 font-semibold"
        >
          Attempt {attempt.number}
          <ExpandIcon size={14} weight="bold" className="text-ink-faint" aria-hidden />
        </button>
      }
    >
      <ul className="flex flex-col">
        {[...item.attempts].reverse().map((candidate) => {
          const current = candidate.id === attempt.id;
          const taken = candidate.id === other.id;
          return (
            <li key={candidate.id}>
              <PopoverClose asChild>
                <button
                  type="button"
                  disabled={taken}
                  aria-current={current || undefined}
                  onClick={() => onPick(candidate.id)}
                  className={cn(
                    "focus-ring flex min-h-10 w-full items-center gap-2.5 rounded-md px-2.5 text-left",
                    current ? "bg-semolina-soft/60" : "hover:bg-ink/4",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "size-2.5 shrink-0 rounded-full",
                      outcomeDots[candidate.outcome ?? "printing"],
                      taken && "opacity-40",
                    )}
                  />
                  <span className="text-small text-ink font-semibold">Attempt {candidate.number}</span>
                  <span className="text-small text-ink-faint ml-auto">
                    {candidate.outcome ? OUTCOME_LABELS[candidate.outcome] : "Printing"}
                    {taken && " · other side"}
                  </span>
                </button>
              </PopoverClose>
            </li>
          );
        })}
      </ul>
    </Popover>
  );
}

/** Phones compare an attempt with the one before it: one photo, a switch above it, a swipe moves between. */
function PhoneCompare({ item, older, newer }: { item: ItemView; older: AttemptView; newer: AttemptView }) {
  const [side, setSide] = useState<"older" | "newer">("newer");
  const [picked, pick] = usePickedPhotos();
  const attempt = side === "older" ? older : newer;
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const onDown = (event: PointerEvent) => {
    swipe.current = { x: event.clientX, y: event.clientY };
  };
  const onUp = (event: PointerEvent) => {
    const start = swipe.current;
    swipe.current = null;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    // A deliberate sideways stroke: left shows the newer one, right the older one.
    if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    setSide(dx < 0 ? "newer" : "older");
  };
  return (
    <div className="flex flex-col gap-5">
      <SegmentedControl<"older" | "newer">
        label="Attempt shown"
        labelHidden
        options={[
          { value: "older", label: `Attempt ${older.number}` },
          { value: "newer", label: `Attempt ${newer.number}` },
        ]}
        value={side}
        onChange={setSide}
      />
      <div
        // Sideways swipes switch; vertical ones still scroll the sheet.
        className="touch-pan-y"
        onPointerDown={onDown}
        onPointerUp={onUp}
        onPointerCancel={() => {
          swipe.current = null;
        }}
      >
        <AttemptPhotos
          fade
          attempt={attempt}
          photos={photosOf(item, attempt)}
          picked={picked[attempt.id]}
          onPick={(photoId) => pick(attempt.id, photoId)}
        />
      </div>
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2.5">
          <OutcomeChip outcome={attempt.outcome} />
          <span className="text-body text-ink font-semibold">Attempt {attempt.number}</span>
          <span className="text-small text-ink-faint ml-auto">{when(attempt)}</span>
        </div>
        <AttemptWords attempt={attempt} />
      </div>
      <CompareTable older={older} newer={newer} />
    </div>
  );
}
