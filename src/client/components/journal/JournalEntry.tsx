import type { JournalEntry as Entry, Item, Person, Photo as PhotoData } from "@shared/api";
import { isOutcome, outcomeLabel, tagLabel } from "@shared/attempts";
import { dateFormat } from "@shared/date-format";
import { attemptPartsLabel } from "@shared/parts";
import { isOffTheBed, offTheBedLabel } from "@shared/print-progress";
import { fullTime, relativeTime } from "@shared/time";
import { Link } from "@tanstack/react-router";
import { forwardRef, type ReactNode, useRef, useState } from "react";
import { OutcomeChip, outcomeIcons } from "@/components/builds/Outcome";
import { SettingsLine } from "@/components/builds/SettingsLine";
import { summarizeSettings } from "@/components/builds/settings";
import { Avatar, ViaText } from "@/components/ui/Avatar";
import { coverPhoto, PhotoCountBadge, SlicerPreviewBadge } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import {
  BuildsIcon,
  CheckIcon,
  FinishIcon,
  type Icon,
  IdeasIcon,
  PrintingIcon,
  ShelveIcon,
  SlicerFileIcon,
} from "@/components/ui/icons";
import { MetaList } from "@/components/ui/MetaList";
import { OpenLarge, useLargePhotos } from "@/components/ui/OpenLarge";
import { Photo } from "@/components/ui/Photo";
import { PhotoRow } from "@/components/ui/PhotoRow";
import { PrintProgress } from "@/components/ui/PrintProgress";
import { useTagOptions } from "@/lib/builds";
import { cn } from "@/lib/cn";
import { heroClick } from "@/lib/hero";
import { itemName } from "@/lib/item-name";
import { coverOf, fileThumbSrc, photoSrc } from "@/lib/previews";
import { useNow } from "@/lib/use-now";

/** Where an entry leads: the attempt in its build, the build, or the idea. */
export function entryLink(entry: Entry, item: Pick<Item, "id" | "stage">) {
  if (entry.kind === "attempt" && entry.attemptId) {
    return { to: "/builds/$buildId", params: { buildId: item.id }, search: { attempt: entry.attemptId } } as const;
  }
  if (item.stage === "idea") return { to: "/ideas/$ideaId", params: { ideaId: item.id } } as const;
  return { to: "/builds/$buildId", params: { buildId: item.id } } as const;
}

const clock = (time: number) => dateFormat({ hour: "numeric", minute: "2-digit" }).format(time);
const weekday = (time: number) => dateFormat({ weekday: "short", day: "numeric", month: "short" }).format(time);

interface JournalEntryProps {
  entry: Entry;
  item: Item;
  person?: Person;
  /** The agent it was made through. */
  via?: string;
  /** Picked with J and K on desktop. */
  selected?: boolean;
  /** "time" under a day heading ("14:05"), "date" under a week heading ("Tue 27"). */
  when: "time" | "date";
  /** One quiet row for every kind of entry, attempts included: Today's "Lately" uses it. */
  compact?: boolean;
}

/**
 * One thing that happened. A print attempt is a card that leads with its
 * photo, and a spaghetti attempt gets the same care as a success: its failure
 * tags in plain view. Ideas captured and builds started, finished or shelved
 * are quieter rows between them. With `compact`, attempts are rows too.
 */
export const JournalEntry = forwardRef<HTMLAnchorElement, JournalEntryProps>(function JournalEntry(props, ref) {
  if (props.entry.kind !== "attempt") return <EventRow {...props} ref={ref} />;
  return props.compact ? <AttemptRow {...props} ref={ref} /> : <AttemptCard {...props} ref={ref} />;
});

const AttemptCard = forwardRef<HTMLAnchorElement, JournalEntryProps>(function AttemptCard(
  { entry, item, person, via, selected, when },
  ref,
) {
  const failureOptions = useTagOptions("failure");
  const successOptions = useTagOptions("success");
  const index = item.attempts.findIndex((a) => a.id === entry.attemptId);
  const attempt = item.attempts[index];
  const photos = item.photos.filter((photo) => attempt && photo.attemptId === attempt.id);
  const offBed = !!attempt && isOffTheBed(attempt);
  const name = itemName(item);
  // The photo opens large over the journal; the rest of the card opens the build.
  const large = useLargePhotos(photos, {
    title: `${name.text} · attempt ${index + 1}`,
    badge: attempt && <OutcomeChip outcome={attempt.outcome} offTheBed={offBed} />,
    detail: attempt && [person?.name, relativeTime(attempt.printedAt)].filter(Boolean).join(" · "),
  });
  const photoFrame = useRef<HTMLButtonElement>(null);
  if (!attempt) return null;
  const partsLabel = attemptPartsLabel(attempt, item.parts);
  const [photo] = photos;
  // No photo yet, but the slicer's picture of the plate: shown in the photo's place and labeled as a preview.
  const plate = !photo && attempt.file?.hasThumb ? attempt.file : undefined;
  const picture = !!(photo || plate);
  const filaments = attempt.settings.filaments ?? [];
  const settings = summarizeSettings(attempt.settings).slice(0, 3);
  const time = when === "time" ? clock(attempt.printedAt) : weekday(attempt.printedAt);

  // The card's words and meta: beside its picture, or below it on a phone.
  const words = (
    <>
      <div
        className={cn(
          "flex flex-col gap-2.5",
          plate &&
            "col-start-2 row-start-2 min-w-0 pt-0.5 pl-3 md:col-span-3 md:col-start-3 md:row-start-1 md:px-4 md:pt-3",
        )}
      >
        {/* Without a picture, the outcome leads the card. */}
        {!picture && (
          <div className="flex items-center gap-2">
            <OutcomeChip outcome={attempt.outcome} offTheBed={offBed} />
            <Meta at={attempt.printedAt} time={time} person={person} via={via} printer={attempt.fromPrinter} />
          </div>
        )}
        <div className="flex items-baseline gap-2">
          <h3 className="text-body text-ink min-w-0 flex-1 font-sans">
            <MetaList>
              <span className={cn("break-words", name.titled ? "font-semibold" : "font-medium")}>{name.text}</span>
              <span className="text-small text-ink-faint font-medium whitespace-nowrap">attempt {index + 1}</span>
            </MetaList>
          </h3>
          {picture && (
            <Meta
              at={attempt.printedAt}
              time={time}
              person={person}
              via={via}
              className={cn(plate && "max-md:hidden")}
            />
          )}
        </div>
        {partsLabel && <p className="text-small text-ink-soft -mt-1.5 break-words">{partsLabel}</p>}
      </div>
      <div
        className={cn(
          "flex flex-1 flex-col gap-2.5",
          plate &&
            "col-span-2 row-start-3 px-2.5 pt-3 pb-2.5 md:col-span-3 md:col-start-3 md:row-start-2 md:px-4 md:pt-2.5 md:pb-3",
        )}
      >
        {attempt.outcome === null && !offBed && (
          <PrintProgress
            startedAt={attempt.printedAt}
            estimatedMinutes={attempt.settings.estimatedMinutes}
            attemptId={attempt.id}
          />
        )}
        {offBed && attempt.endedAt !== null && (
          <p className="text-small text-ink-soft">
            <span className="text-ink font-semibold">{offTheBedLabel(attempt.endedAt)}</span> · how did it go?
          </p>
        )}
        {attempt.note && <p className="text-body text-ink line-clamp-3 break-words">{attempt.note}</p>}
        {(attempt.failureTags.length > 0 || attempt.successNotes.length > 0) && (
          <ul className="flex flex-wrap gap-1.5" aria-label="Tags">
            {attempt.failureTags.map((slug) => (
              <li key={`f-${slug}`}>
                <Chip tone="tomato">{tagLabel("failure", slug, failureOptions)}</Chip>
              </li>
            ))}
            {attempt.successNotes.map((slug) => (
              <li key={`s-${slug}`}>
                <Chip tone="basil" icon={CheckIcon}>
                  {tagLabel("success", slug, successOptions)}
                </Chip>
              </li>
            ))}
          </ul>
        )}
        {(filaments.length > 0 || settings.length > 0) && (
          <SettingsLine
            filaments={filaments}
            parts={settings}
            name={(filament) => [filament.colorName, filament.type].filter(Boolean).join(" ") || "Filament"}
            className="text-small text-ink-faint mt-auto"
            filamentClassName="text-ink-soft"
          />
        )}
      </div>
    </>
  );

  if (photo) {
    // The photo and the link are siblings (a button can't sit inside a link): the link's own box covers the card, so a
    // press anywhere but the photo opens the build, and the photo sits above it.
    return (
      <div
        className={cn(
          "group bg-cream shadow-soft hover:shadow-raised hover:bg-lifted pressable relative flex flex-col rounded-lg p-1.5 md:flex-row",
          "has-[>a:focus-visible]:shadow-ring",
          selected && "shadow-ring hover:shadow-ring",
        )}
      >
        <OpenLarge
          ref={photoFrame}
          {...large.opens(0)}
          label={photos.length > 1 ? `Open its ${photos.length} photos large` : "Open the photo large"}
          className="relative z-10 aspect-4/3 shrink-0 rounded-md md:w-2/5"
        >
          <Photo
            src={photoSrc(photo.id, "large")}
            // The card's own text names it; the picture would only repeat that.
            alt=""
            color={photo.color || undefined}
            className="size-full"
            imgClassName="group-hover:scale-[1.02] transition-[opacity,transform] duration-slow"
          />
          <OutcomeChip
            outcome={attempt.outcome}
            offTheBed={offBed}
            onPhoto
            className="shadow-soft absolute bottom-2 left-2"
          />
          {photos.length > 1 && (
            <span className="absolute top-2 right-2">
              <PhotoCountBadge count={photos.length} />
            </span>
          )}
        </OpenLarge>
        <Link
          ref={ref}
          {...entryLink(entry, item)}
          viewTransition
          onClick={(event) => heroClick(event, photo.id, photoFrame.current?.querySelector("img")?.parentElement)}
          aria-current={selected || undefined}
          className="flex min-w-0 flex-1 flex-col gap-2.5 px-2.5 pt-3 pb-2.5 outline-none after:absolute after:inset-0 after:rounded-lg md:px-4 md:py-3"
        >
          {/* How it went leads the link's name, as on every attempt card; on screen it is the chip on the photo. */}
          <span className="sr-only">
            <OutcomeChip outcome={attempt.outcome} offTheBed={offBed} />
          </span>
          {words}
        </Link>
        {large.viewer}
      </div>
    );
  }

  return (
    <Link
      ref={ref}
      {...entryLink(entry, item)}
      viewTransition
      aria-current={selected || undefined}
      className={cn(
        "group bg-cream shadow-soft hover:shadow-raised hover:bg-lifted pressable focus-ring rounded-lg p-1.5",
        // A render isn't the result: on a phone it is a small picture beside the title, under a top row that says what
        // it is, with the progress and settings full width below; from md it is the card's picture at the left.
        plate ? "grid max-md:grid-cols-[auto_minmax(0,1fr)] md:grid-cols-5 md:grid-rows-[auto_1fr]" : "flex flex-col",
        selected && "shadow-ring hover:shadow-ring",
      )}
    >
      {plate && (
        <>
          {/* Phones: the top row says what this is (a render, not a photo of the result) and how it went. */}
          <div className="col-span-2 row-start-1 flex items-center gap-2 px-1 pt-1 pb-2 md:hidden">
            <OutcomeChip outcome={attempt.outcome} offTheBed={offBed} />
            <span className="text-caption text-ink-faint inline-flex items-center gap-1 font-semibold">
              <SlicerFileIcon size={12} weight="fill" aria-hidden />
              From the model
            </span>
            <Meta at={attempt.printedAt} time={time} person={person} via={via} printer={attempt.fromPrinter} />
          </div>
          <div className="relative col-start-1 row-start-2 size-24 overflow-hidden rounded-md md:col-span-2 md:row-span-2 md:row-start-1 md:aspect-4/3 md:h-auto md:w-full">
            {/* A render, not a photo: the whole plate on the well, not cropped to fill. */}
            <Photo
              src={fileThumbSrc(plate)}
              alt=""
              fit="contain"
              frame="render"
              className="size-full p-1.5 md:p-3"
              imgClassName="group-hover:scale-[1.02] transition-[opacity,transform] duration-slow"
            />
            <span className="absolute top-2 left-2 max-md:hidden">
              <SlicerPreviewBadge />
            </span>
            <OutcomeChip
              outcome={attempt.outcome}
              offTheBed={offBed}
              onPhoto
              className="shadow-soft absolute bottom-2 left-2 max-md:hidden"
            />
          </div>
        </>
      )}
      <div className={plate ? "contents" : "flex min-w-0 flex-1 flex-col gap-2.5 px-2.5 pt-3 pb-2.5 md:px-4 md:py-3"}>
        {words}
      </div>
    </Link>
  );
});

function Meta({
  at,
  time,
  person,
  via,
  printer,
  className,
}: {
  at: number;
  time: string;
  person?: Person;
  via?: string;
  /** A print from the printer: the printer's mark, or `person` when someone said they started it (decision 0076). */
  printer?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "text-small text-ink-faint tabular ml-auto flex shrink-0 items-center gap-2 self-center pl-2",
        className,
      )}
    >
      {!printer && <ViaText name={via} person={person?.name} className="hidden md:inline" />}
      <time dateTime={new Date(at).toISOString()} title={fullTime(at)}>
        {time}
      </time>
      {printer ? <Printer person={person} /> : person && <Avatar person={person} size="xs" via={via} />}
    </span>
  );
}

const events: Record<Exclude<Entry["kind"], "attempt">, { icon: Icon; label: (item: Item) => string }> = {
  idea: { icon: IdeasIcon, label: () => "Captured an idea" },
  started: {
    icon: BuildsIcon,
    label: (item) =>
      item.startedAt !== null && item.startedAt - item.createdAt > 60_000 ? "Started building" : "Started a build",
  },
  finished: {
    icon: FinishIcon,
    label: (item) => {
      const tries = item.attempts.length;
      return tries ? `Finished after ${tries} ${tries === 1 ? "attempt" : "attempts"}` : "Finished";
    },
  },
  shelved: { icon: ShelveIcon, label: () => "Shelved for now" },
};

const EventRow = forwardRef<HTMLAnchorElement, JournalEntryProps>(function EventRow(
  { entry, item, person, via, selected, when },
  ref,
) {
  // A title that comes to a row drawn without one (Claude naming an idea just saved) fades in where it lands.
  const [untitled] = useState(!item.title?.trim());
  if (entry.kind === "attempt") return null;
  const event = events[entry.kind];
  const EventIcon = event.icon;
  // The thing's cover by the one rule (coverOf): its best photo, else its newest plate render; else the event's icon.
  const cover = coverOf(item);
  const photo = cover.kind === "photo" ? cover.photo : undefined;
  const name = itemName(item);
  const finished = entry.kind === "finished";
  return (
    <PhotoRow
      ref={ref}
      link={{ ...entryLink(entry, item), viewTransition: true, onClick: (event) => heroClick(event, photo?.id) }}
      photo={coverPhoto(cover, "") ?? null}
      tile={<EventIcon size={finished ? 26 : 22} aria-hidden />}
      tileClassName={finished ? "bg-basil-soft text-basil-ink" : "bg-ink/5 text-ink-faint"}
      size={finished ? "md" : "sm"}
      faded={entry.kind === "shelved"}
      selected={selected}
      className="-mx-2"
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <MetaList className="text-small">
          <span
            className={cn("flex items-center gap-1.5 font-semibold", finished ? "text-basil-ink" : "text-ink-faint")}
          >
            {/* One icon per row: the tile has it when no photo fills the tile; with a photo this is the only mark of the kind. */}
            {photo && <EventIcon size={15} weight={finished ? "fill" : "regular"} aria-hidden />}
            {event.label(item)}
          </span>
          <time
            dateTime={new Date(entry.at).toISOString()}
            title={fullTime(entry.at)}
            className="text-ink-faint tabular font-medium whitespace-nowrap"
          >
            {when === "time" ? clock(entry.at) : weekday(entry.at)}
          </time>
        </MetaList>
        {
          // While Claude names it (decision 0072) the name's place says so.
          item.titleJob?.status === "naming" && !name.titled ? (
            <Naming since={item.titleJob.since}>{name.text}</Naming>
          ) : (
            <span
              key={name.titled ? "title" : "note"}
              className={cn(
                "text-body truncate",
                name.titled ? "text-ink font-semibold" : "text-ink-soft font-medium",
                finished && "font-display text-title",
                name.titled && untitled && "sg-arrive",
              )}
            >
              {name.text}
            </span>
          )
        }
      </span>
      <ViaText name={via} person={person?.name} className="text-small hidden md:inline" />
      {person && <Avatar person={person} size="xs" via={via} className="shrink-0" />}
    </PhotoRow>
  );
});

const outcomeInk = {
  success: "text-basil-ink",
  partial: "text-semolina-ink",
  failed: "text-tomato-ink",
  printing: "text-semolina-ink",
} as const;

/**
 * An attempt as one quiet row, like the event rows: a thumbnail (its photo, the
 * plate's picture, or the build's icon), the outcome's icon and word in its
 * ink with the time, then the build's name and "attempt 2".
 */
const AttemptRow = forwardRef<HTMLAnchorElement, JournalEntryProps>(function AttemptRow(
  { entry, item, person, via, selected, when },
  ref,
) {
  const index = item.attempts.findIndex((a) => a.id === entry.attemptId);
  const attempt = item.attempts[index];
  if (!attempt) return null;
  const [photo] = item.photos.filter((candidate) => candidate.attemptId === attempt.id);
  // No photo or file of its own: the build's render (its own files, or its twist's model), else the glyph.
  const cover = photo || attempt.file?.hasThumb ? undefined : coverOf(item);
  const plate = photo
    ? undefined
    : attempt.file?.hasThumb
      ? attempt.file
      : cover?.kind === "plate"
        ? cover.file
        : undefined;
  const name = itemName(item);
  const offBed = isOffTheBed(attempt);
  const OutcomeIcon = isOutcome(attempt.outcome) ? outcomeIcons[attempt.outcome] : offBed ? FinishIcon : PrintingIcon;
  const ink = outcomeInk[attempt.outcome ?? "printing"];
  const estimated = attempt.outcome === null && !offBed && attempt.settings.estimatedMinutes !== undefined;
  return (
    <Link
      ref={ref}
      {...entryLink(entry, item)}
      viewTransition
      onClick={(event) => heroClick(event, photo?.id)}
      aria-current={selected || undefined}
      className={cn(
        "pressable focus-ring hover:bg-ink/4 -mx-1.5 flex items-center gap-3.5 rounded-lg p-1.5",
        selected && "shadow-ring",
      )}
    >
      {photo ? (
        <Photo
          src={photoSrc(photo.id, "thumb")}
          alt=""
          color={photo.color || undefined}
          className="size-12 shrink-0 rounded-md"
        />
      ) : plate ? (
        <Photo
          src={fileThumbSrc(plate)}
          alt=""
          fit="contain"
          frame="render-tile"
          className="size-12 shrink-0 rounded-md p-1"
        />
      ) : (
        <span className="bg-ink/5 text-ink-faint flex size-12 shrink-0 items-center justify-center rounded-md">
          <BuildsIcon size={22} aria-hidden />
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <MetaList className="text-small">
          <span className={cn("flex items-center gap-1.5 font-semibold", ink)}>
            <OutcomeIcon size={15} aria-hidden />
            {outcomeLabel(attempt.outcome) ?? (offBed ? "Off the bed" : "Printing")}
          </span>
          <time
            dateTime={new Date(attempt.printedAt).toISOString()}
            title={fullTime(attempt.printedAt)}
            className="text-ink-faint tabular font-medium whitespace-nowrap"
          >
            {when === "time" ? clock(attempt.printedAt) : weekday(attempt.printedAt)}
          </time>
        </MetaList>
        <span className="text-body flex min-w-0 items-baseline gap-2">
          <span className={cn("truncate", name.titled ? "text-ink font-semibold" : "text-ink-soft font-medium")}>
            {name.text}
          </span>
          <span className="text-small text-ink-faint font-medium whitespace-nowrap">attempt {index + 1}</span>
        </span>
      </span>
      {estimated && (
        <PrintProgress
          variant="ring"
          startedAt={attempt.printedAt}
          estimatedMinutes={attempt.settings.estimatedMinutes}
          attemptId={attempt.id}
        />
      )}
      {attempt.fromPrinter ? (
        <Printer person={person} className="text-small" />
      ) : (
        <>
          <ViaText name={via} person={person?.name} className="text-small hidden md:inline" />
          {person && <Avatar person={person} size="xs" via={via} className="shrink-0" />}
        </>
      )}
    </Link>
  );
});

/**
 * A captured idea's name while Claude names it (decision 0072): the plain words "Naming…", for 15 seconds at most, then
 * its name as before. Plain words and the clock the Journal already has, so its first load doesn't carry the cards'
 * sparkle. The 15 s is `NAMING_TIMEOUT_MS` (shared/naming.ts) written out: imported, it would be a chunk of its own in
 * the Journal's first load, which is at its ceiling; test/unit/naming.test.ts keeps the two equal.
 */
function Naming({ since, children }: { since: number; children: ReactNode }) {
  const now = useNow(5000);
  if (now >= since + 15_000) return <span className="text-body text-ink-soft truncate font-medium">{children}</span>;
  return <span className="text-small text-ink-faint min-h-6">Naming…</span>;
}

/**
 * A print from the printer where a person would be (decision 0076): the printer's mark and, from tablet width up, "From
 * the printer"; once someone said who started it, their avatar with the printer's small mark. Drawn here, small, as the
 * Journal and Lately are first loads (the line itself is `PrinterByline`, ui/PrinterMark.tsx).
 */
function Printer({ person, className }: { person?: Person; className?: string }) {
  return (
    <>
      <span className={cn("text-ink-faint hidden whitespace-nowrap md:inline", className)}>
        {person ? `${person.name} · from the printer` : "From the printer"}
      </span>
      {person ? (
        <Avatar person={person} size="xs" printer className="shrink-0" />
      ) : (
        <span role="img" aria-label="The printer" title="The printer" className="printer-mark size-6 shrink-0" />
      )}
    </>
  );
}
