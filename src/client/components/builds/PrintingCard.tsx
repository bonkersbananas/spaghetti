import type { Person } from "@shared/api";
import type { Outcome } from "@shared/attempts";
import { attemptPartsLabel } from "@shared/parts";
import { isOffTheBed } from "@shared/print-progress";
import { Link, useNavigate } from "@tanstack/react-router";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { Fragment, useRef } from "react";
import { AutoHeight } from "@/components/ui/AutoHeight";
import { Avatar, ViaText } from "@/components/ui/Avatar";
import { Button, IconButton } from "@/components/ui/Button";
import { UnreadBadge } from "@/components/ui/Card";
import { CoverPicture } from "@/components/ui/CoverPicture";
import { BuildsIcon, CameraIcon } from "@/components/ui/icons";
import { MetaList } from "@/components/ui/MetaList";
import { PrintProgress } from "@/components/ui/PrintProgress";
import { Swatch } from "@/components/ui/Swatch";
import { useCapture } from "@/lib/capture";
import { cn } from "@/lib/cn";
import { itemName } from "@/lib/item-name";
import { type AttemptView, addPhotosToItem, type ItemView } from "@/lib/items";
import { duration, ease } from "@/lib/motion";
import { coverOf } from "@/lib/previews";
import { usePrintProgress } from "@/lib/print-progress";
import { useReadOnly } from "@/lib/read-only";
import { useIsDesktop } from "@/lib/use-media-query";
import { OffTheBed } from "./OffTheBed";
import { OutcomeChip, OutcomePicker } from "./Outcome";
import { PhotoReadNote } from "./PhotoReadNote";

interface PrintingCardProps {
  item: ItemView;
  /** The attempt that is on the bed (its outcome is null). */
  attempt: AttemptView;
  /** Who started it. */
  person?: Person;
  via?: string;
  /**
   * Phones only: a small square picture beside the name instead of the big one on top, for the prints after
   * the first on Today (so three prints don't push the rest two screens down) and for every print in the Journal's
   * Now block. Desktop is unchanged.
   */
  compact?: boolean;
  /**
   * From `lg`: `row` (Today's column: the picture on two fifths, the text beside it), `half` (one print across the
   * Builds list: the picture on half the card, 16:9), or the picture on top for prints side by side, `wide` (two
   * across, 16:9) or `stack` (three across, 4:3), so the focal cards' pictures are never smaller than the grid's below.
   */
  desktop?: "row" | "half" | "wide" | "stack";
  /**
   * The other person's unread comments, on the picture's corner as the grid's cards show them: Builds only. Today and
   * the Journal's Now say them in their own comment line under the prints, so their cards don't repeat it.
   */
  unread?: number;
}

/** The spools on one line: the first with its swatch, and "+N" for the others (their names are on the build). */
function FilamentGlance({ filaments }: { filaments: NonNullable<AttemptView["settings"]["filaments"]> }) {
  const [first, ...rest] = filaments;
  if (!first) return null;
  const name = (filament: typeof first) => [filament.colorName, filament.type].filter(Boolean).join(" ") || "Filament";
  return (
    <span className="tabular flex min-w-0 items-center gap-1.5 font-medium" title={filaments.map(name).join(", ")}>
      {first.colorHex && <Swatch color={first.colorHex} />}
      <span className="min-w-0 truncate">{name(first)}</span>
      {rest.length > 0 && <span className="text-ink-faint shrink-0 font-normal">+{rest.length}</span>}
    </span>
  );
}

/** What `desktop` changes from `lg`, over the md row. */
const desktopLayouts = {
  // The row's picture takes the height the text gives it (never less than min-h), so a short card ends where its words end.
  row: { card: "", picture: "md:aspect-auto md:min-h-32", head: "", body: "" },
  half: {
    card: "lg:grid-cols-2",
    picture: "md:aspect-4/3 lg:col-span-1 lg:aspect-video",
    head: "lg:col-span-1 lg:px-5 lg:pt-4",
    body: "lg:col-span-1 lg:px-5 lg:pb-4",
  },
  wide: {
    card: "lg:grid-cols-1 lg:grid-rows-[auto_auto_1fr]",
    picture: "md:aspect-4/3 lg:col-span-1 lg:row-span-1 lg:aspect-video",
    head: "lg:col-span-1 lg:px-2 lg:pt-3",
    body: "lg:col-span-1 lg:px-2 lg:pb-2",
  },
  stack: {
    card: "lg:grid-cols-1 lg:grid-rows-[auto_auto_1fr]",
    picture: "md:aspect-4/3 lg:col-span-1 lg:row-span-1",
    head: "lg:col-span-1 lg:px-2 lg:pt-3",
    body: "lg:col-span-1 lg:px-2 lg:pb-2",
  },
} as const;

/** The card's grid on phones, big or compact; from md both are the same row: picture on two fifths, text beside. */
const layouts = {
  big: { card: "grid-cols-1", picture: "aspect-4/3", head: "px-2 pt-2.5", body: "px-2 pt-2.5 pb-2" },
  compact: {
    card: "grid-cols-[auto_minmax(0,1fr)]",
    picture: "size-20 self-start",
    head: "pr-2 pl-3",
    body: "col-span-2 px-2 pt-2.5 pb-2",
  },
} as const;

/**
 * A print on the bed, big and warm: the build's picture, its name in Fraunces (the one card title that is,
 * because this is the screen's focal point), how far along it is, and one way to log it. The card leads to
 * the build; while it prints, "How did it go?" (the build page's own question and words) goes to the build with
 * the attempt's sheet open. When the print should be done, the button gives way to the outcomes themselves, one
 * tap next to the printer, which open the sheet with that answer chosen.
 */
export function PrintingCard({
  item,
  attempt,
  person,
  via,
  compact = false,
  desktop = "row",
  unread = 0,
}: PrintingCardProps) {
  const layout = layouts[compact ? "compact" : "big"];
  const wide = desktopLayouts[desktop];
  // Each time a compact card becomes the big one on a phone (or back), its content is swapped and fades in; from
  // md both layouts are the same row, so nothing is swapped there, and a change of breakpoint never remounts it.
  const isDesktop = useIsDesktop();
  const swaps = useRef(0);
  const lastCompact = useRef(compact);
  if (lastCompact.current !== compact) {
    lastCompact.current = compact;
    if (!isDesktop) swaps.current += 1;
  }
  const reduce = useReducedMotion();
  const navigate = useNavigate();
  const readOnly = useReadOnly(item.pending);
  const offBed = isOffTheBed(attempt);
  const progress = usePrintProgress(attempt.id, attempt.printedAt, attempt.settings.estimatedMinutes);
  const due = progress.state === "due";
  const showUnread = unread > 0;
  // The build's cover, with the plate on the bed first when there is no photo.
  const cover = coverOf(item, { file: attempt.file });
  // Its name is right beside the picture, in Fraunces: a build with only a name shows the glyph, not its name twice.
  // So does a compact card's small square on a phone, too small for words (from md it is the full row).
  const glyph = cover.kind === "note" ? <BuildsIcon size={compact ? 28 : 36} /> : undefined;
  const nameOnly = cover.kind === "note" && cover.fromTitle;
  const name = itemName(item);
  const partsLabel = attemptPartsLabel(attempt, item.parts);
  const filaments = attempt.settings.filaments ?? [];

  // "Snap this print": on a phone the camera opens at once and the photo lands in the capture sheet already aimed at
  // this print; on desktop (no camera) the sheet opens aimed, ready for a drop or a note.
  const { snapPrint } = useCapture();
  const camera = useRef<HTMLInputElement>(null);
  const aim = { itemId: item.id, attemptId: attempt.id, name: item.title || "the build", number: attempt.number };

  const finish = (outcome?: Outcome) =>
    void navigate({
      to: "/builds/$buildId",
      params: { buildId: item.id },
      search: { attempt: attempt.id, finish: outcome ?? "1" },
    });

  const to = { to: "/builds/$buildId", params: { buildId: item.id }, search: { attempt: attempt.id } } as const;

  return (
    // On Today a compact card that becomes the first turns into the big one: Today's AutoHeight grows the box, and
    // the new layout fades in here (the compact one leaves at once), so nothing slides through anything.
    <article className="bg-cream shadow-soft hover:shadow-raised hover:bg-lifted duration-fast relative h-full rounded-lg p-1.5 transition-shadow has-[a:focus-visible]:shadow-[var(--sg-ring)]">
      <m.div
        key={swaps.current}
        initial={swaps.current > 0 && !reduce ? { opacity: 0 } : false}
        animate={{ opacity: 1, transition: { duration: duration.base } }}
        className={cn("grid md:h-full md:grid-cols-5 md:grid-rows-[auto_1fr]", layout.card, wide.card)}
      >
        <div
          className={cn(
            "relative overflow-hidden rounded-md md:col-span-2 md:row-span-2 md:h-auto md:w-full md:self-stretch",
            // A big card with only a note keeps a shorter strip on phones: a 4:3 index card would only push the
            // print's state down; the slicer's plate picture (a render, not the result) gets a calmer 16:9.
            compact
              ? layout.picture
              : cover.kind === "note"
                ? "aspect-5/2"
                : cover.kind === "plate"
                  ? "aspect-video"
                  : layout.picture,
            wide.picture,
          )}
        >
          {/* From md the picture is laid over the frame, not in it, so a tall picture (a square plate render) never
              sets the card's height: the frame takes it from the text. */}
          <div className="size-full md:absolute md:inset-0">
            {cover.kind === "note" && !nameOnly ? (
              // A note: in the phone's 5:2 strip (or, compact, the glyph: its square is too small for words), and in
              // the desktop row's 4:3, each set by the frame's short side.
              <>
                <CoverPicture
                  cover={cover}
                  glyph={compact ? glyph : undefined}
                  shape="strip"
                  className="size-full md:hidden"
                />
                <CoverPicture cover={cover} shape="wide" className="size-full max-md:hidden" />
              </>
            ) : (
              <CoverPicture
                cover={cover}
                // A compact card's square on a phone is too small to carry it; from md it is the full row's picture. An
                // unread badge takes the corner, as on the grid's cards.
                label={showUnread ? false : compact ? "md" : true}
                glyph={nameOnly ? glyph : undefined}
                inset={compact ? "p-1 md:p-3" : "p-3"}
                className="size-full"
              />
            )}
          </div>
          {/* The picture and the name lead to the build, each with its own area; the progress below has its own, so
              nothing presses through a button. This one is for the pointer only: the name's link is the stop for the keyboard. */}
          <Link {...to} tabIndex={-1} aria-hidden className="absolute inset-0 z-10" />
          {showUnread && (
            <span
              className={cn(
                "pointer-events-none absolute z-20",
                compact ? "top-1.5 left-1.5 md:top-2 md:left-2" : "top-2 left-2",
              )}
            >
              <UnreadBadge count={unread} />
            </span>
          )}
          {/* On a compact card the words under it say the same, and a chip would cover the small picture. Off the bed
              the line beside the picture says so ("Off the bed at 10:42 · how did it go?"), so it isn't said twice. */}
          {!offBed && (
            <OutcomeChip
              outcome={null}
              onPhoto
              className={cn(
                "shadow-soft pointer-events-none absolute bottom-2 left-2 z-20",
                compact && "max-md:hidden",
              )}
            />
          )}
        </div>
        <div
          className={cn(
            "pointer-events-none relative flex min-w-0 flex-col md:col-span-3 md:px-4 md:pt-3",
            compact ? "gap-1.5 md:gap-2.5" : "gap-2.5",
            layout.head,
            wide.head,
          )}
        >
          <Link
            {...to}
            className="pointer-events-auto absolute inset-0 z-0 rounded-lg shadow-none outline-none focus-visible:shadow-none"
          >
            <span className="sr-only">
              {name.text}, attempt {attempt.number}
              {partsLabel ? `, ${partsLabel}` : ""}
            </span>
          </Link>
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
                <ViaText name={via} person={person?.name} className="hidden md:inline" />
                <Avatar person={person} size="xs" via={via} />
              </span>
            )}
          </div>
          <div className="text-small text-ink-faint flex min-w-0 flex-col gap-0.5">
            <MetaList>
              <span className="whitespace-nowrap">Attempt {attempt.number}</span>
              {partsLabel && <span>{partsLabel}</span>}
            </MetaList>
            {/* One line for the spools, however many: the first named, "+1" for the rest, so every card has the same rhythm. */}
            {filaments.length > 0 && <FilamentGlance filaments={filaments} />}
          </div>
        </div>
        <div
          className={cn(
            "pointer-events-none relative flex min-w-0 flex-col gap-2.5 md:col-span-3 md:px-4 md:pt-2.5 md:pb-3",
            layout.body,
            wide.body,
          )}
        >
          {offBed && attempt.endedAt !== null ? (
            // The printer says it stopped: no bar to draw, only the calm question and the three answers.
            <OffTheBed
              endedAt={attempt.endedAt}
              onPick={(outcome) => finish(outcome)}
              photoRead={attempt.photoRead}
              withTags={false}
              // Offline a saved build can't be changed (decision 0005), as in the attempt sheet: no photo then.
              onPhotos={
                readOnly || item.photos.some((photo) => photo.attemptId === attempt.id)
                  ? undefined
                  : (files) => addPhotosToItem(item.id, files, attempt.id)
              }
              className="pointer-events-auto md:mt-auto"
            />
          ) : (
            <>
              {/* At the card's foot, so cards side by side have their "How did it go?" buttons on one line. */}
              <div className="flex flex-col gap-1.5 md:mt-auto">
                <PrintProgress
                  startedAt={attempt.printedAt}
                  estimatedMinutes={attempt.settings.estimatedMinutes}
                  attemptId={attempt.id}
                  showLabel={false}
                />
                <div className="flex items-center justify-between gap-3 md:flex-wrap md:gap-y-2">
                  <p
                    className={cn(
                      "text-small tabular min-w-0 flex-1 md:basis-full",
                      progress.state === "due" ? "text-semolina-ink font-semibold" : "text-ink-soft",
                    )}
                  >
                    {/* "Layer 70 of 205 · 30 min left" breaks between its parts, never inside "30 min left". */}
                    {progress.label.split(" · ").map((part, index, parts) => (
                      <Fragment key={part}>
                        {index > 0 && <span className={cn(compact && "max-md:hidden")}> · </span>}
                        {/* A compact card on a phone has room for one part (the time left, which the bar doesn't say): its line never wraps, so the cards are alike. */}
                        <span
                          className={cn("whitespace-nowrap", compact && index < parts.length - 1 && "max-md:hidden")}
                        >
                          {part}
                        </span>
                      </Fragment>
                    ))}
                  </p>
                  <div className="pointer-events-auto flex shrink-0 items-center gap-1.5 md:ml-auto">
                    {!readOnly && (
                      <IconButton
                        icon={CameraIcon}
                        label="Snap this print"
                        variant="secondary"
                        size="sm"
                        onClick={() => (isDesktop ? snapPrint(aim) : camera.current?.click())}
                      />
                    )}
                    {!due && (
                      <Button variant="secondary" size="sm" onClick={() => finish()} className="shrink-0">
                        How did it go?
                      </Button>
                    )}
                  </div>
                  <input
                    ref={camera}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    hidden
                    data-testid="snap-camera-input"
                    onChange={(event) => {
                      const files = Array.from(event.target.files ?? []);
                      event.target.value = "";
                      if (files.length) snapPrint(aim, files);
                    }}
                  />
                </div>
              </div>
              {due && (
                <div className="pointer-events-auto flex flex-col gap-2 md:mt-auto">
                  <p className="text-body text-ink font-semibold">How did it go?</p>
                  <OutcomePicker
                    value={null}
                    onChange={(outcome) => finish(outcome)}
                    size="md"
                    suggested={attempt.photoRead?.outcome ?? null}
                  />
                  {attempt.photoRead?.status === "read" && <PhotoReadNote read={attempt.photoRead} withTags={false} />}
                </div>
              )}
            </>
          )}
        </div>
      </m.div>
    </article>
  );
}

interface BedCardsProps {
  /** What is physically on the plate: printing, or off the bed and waiting for "how did it go?" (`printingAttempts`). */
  prints: Array<{ item: ItemView; attempt: AttemptView }>;
  people: ReadonlyMap<string, Person>;
  via: (createdVia: string | null | undefined) => string | undefined;
  /**
   * The Builds list, which has the whole width: from `lg` one print takes the row (picture on half the card), two or
   * four sit two across and three (or more) three across, pictures on top. Today's column keeps one row each.
   */
  spread?: boolean;
  /** How many unread comments a build has (Builds passes it; `PrintingCard`'s `unread`). */
  unread?: (itemId: string) => number;
  className?: string;
}

/**
 * The prints on the bed as `PrintingCard`s, on Today and at the top of Builds. On phones one print is the big card and
 * two or more are all compact, so the one that waits for an answer is still on the first screen. A print that gets its
 * answer fades and collapses while the others move up, and a last one left grows into the big card; with reduced
 * motion everything is at its end state at once.
 */
export function BedCards({ prints, people, via, spread = false, unread, className }: BedCardsProps) {
  const reduce = useReducedMotion();
  const isDesktop = useIsDesktop();
  const compact = prints.length > 1;
  const count = prints.length;
  const desktop: PrintingCardProps["desktop"] = !spread
    ? "row"
    : count === 1
      ? "half"
      : count === 2 || count === 4
        ? "wide"
        : "stack";
  const cardProps = (item: ItemView, attempt: AttemptView) => ({
    compact,
    desktop,
    unread: unread?.(item.id),
    item,
    attempt,
    person: people.get(attempt.createdBy),
    via: via(attempt.createdVia),
  });
  return (
    <div
      className={cn(
        "flex flex-col",
        spread && "lg:grid lg:gap-5",
        spread && (desktop === "wide" ? "lg:grid-cols-2" : desktop === "stack" ? "lg:grid-cols-3" : "lg:grid-cols-1"),
        className,
      )}
    >
      <AnimatePresence initial={false}>
        {prints.map(({ item, attempt }) => (
          <m.div
            key={attempt.id}
            // The space under a card is its own padding, so a card that leaves takes its gap with it (in the spread
            // grid the gap is the grid's).
            className={cn("pb-4 last:pb-0", spread && "lg:pb-0")}
            exit={{
              opacity: 0,
              height: 0,
              paddingBottom: 0,
              overflow: "hidden",
              // Faded before the collapse shows a clipped slice of it.
              transition: reduce
                ? { duration: 0 }
                : { duration: duration.base, ease: ease.inOut, opacity: { duration: duration.fast } },
            }}
          >
            {spread && isDesktop ? (
              // Side by side, the cards of a row are as tall as each other; on desktop a card never changes between
              // big and compact, so there is nothing for AutoHeight to animate.
              <PrintingCard {...cardProps(item, attempt)} />
            ) : (
              <AutoHeight trigger={isDesktop ? "row" : compact}>
                <PrintingCard {...cardProps(item, attempt)} />
              </AutoHeight>
            )}
          </m.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
