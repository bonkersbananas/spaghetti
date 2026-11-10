import type { JournalEntry as Entry, Item, Person, Photo as PhotoData } from "@shared/api";
import { tagLabel } from "@shared/attempts";
import { fullTime } from "@shared/time";
import { Link } from "@tanstack/react-router";
import { forwardRef } from "react";
import { OutcomeChip } from "@/components/builds/Outcome";
import { SettingsLine } from "@/components/builds/SettingsLine";
import { summarizeSettings } from "@/components/builds/settings";
import { Avatar } from "@/components/ui/Avatar";
import { PhotoCountBadge } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { BuildsIcon, CheckIcon, FinishIcon, type Icon, IdeasIcon, ShelveIcon } from "@/components/ui/icons";
import { MetaList } from "@/components/ui/MetaList";
import { Photo } from "@/components/ui/Photo";
import { useTagOptions } from "@/lib/builds";
import { cn } from "@/lib/cn";
import { photoSrc } from "@/lib/previews";

/** Where an entry leads: the attempt in its build, the build, or the idea. */
export function entryLink(entry: Entry, item: Pick<Item, "id" | "stage">) {
  if (entry.kind === "attempt" && entry.attemptId) {
    return { to: "/builds/$buildId", params: { buildId: item.id }, search: { attempt: entry.attemptId } } as const;
  }
  if (item.stage === "idea") return { to: "/ideas/$ideaId", params: { ideaId: item.id } } as const;
  return { to: "/builds/$buildId", params: { buildId: item.id } } as const;
}

/** A build's or idea's name: its title, else the first line of its note. */
export function itemName(item: Pick<Item, "title" | "note" | "stage">): { text: string; titled: boolean } {
  if (item.title?.trim()) return { text: item.title.trim(), titled: true };
  const line = item.note.split("\n").find((l) => l.trim());
  if (line) return { text: line.trim(), titled: false };
  return { text: item.stage === "idea" ? "An idea without words" : "Untitled build", titled: false };
}

const newest = (photos: PhotoData[]) =>
  photos.reduce<PhotoData | undefined>(
    (best, photo) => (!best || photo.createdAt > best.createdAt ? photo : best),
    undefined,
  );

/** The photo an entry leads with. */
function entryPhoto(entry: Entry, item: Item): PhotoData | undefined {
  if (entry.kind === "attempt") return item.photos.find((photo) => photo.attemptId === entry.attemptId);
  const cover = item.photos.find((photo) => photo.id === item.coverPhotoId);
  const own = item.photos.find((photo) => !photo.attemptId);
  if (entry.kind === "idea") return own;
  if (entry.kind === "finished") return cover ?? newest(item.photos.filter((photo) => photo.attemptId)) ?? own;
  return cover ?? own ?? newest(item.photos);
}

const clock = (time: number) => new Date(time).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const weekday = (time: number) =>
  new Date(time).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });

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
}

/**
 * One thing that happened. A print attempt is a card that leads with its
 * photo, and a spaghetti attempt gets the same care as a success: its failure
 * tags in plain view. Ideas captured and builds started, finished or shelved
 * are quieter rows between them.
 */
export const JournalEntry = forwardRef<HTMLAnchorElement, JournalEntryProps>(function JournalEntry(props, ref) {
  return props.entry.kind === "attempt" ? <AttemptCard {...props} ref={ref} /> : <EventRow {...props} ref={ref} />;
});

const AttemptCard = forwardRef<HTMLAnchorElement, JournalEntryProps>(function AttemptCard(
  { entry, item, person, via, selected, when },
  ref,
) {
  const failureOptions = useTagOptions("failure");
  const successOptions = useTagOptions("success");
  const index = item.attempts.findIndex((a) => a.id === entry.attemptId);
  const attempt = item.attempts[index];
  if (!attempt) return null;
  const photos = item.photos.filter((photo) => photo.attemptId === attempt.id);
  const [photo] = photos;
  const name = itemName(item);
  const filaments = attempt.settings.filaments ?? [];
  const settings = summarizeSettings(attempt.settings).slice(0, 3);
  const time = when === "time" ? clock(attempt.printedAt) : weekday(attempt.printedAt);

  return (
    <Link
      ref={ref}
      {...entryLink(entry, item)}
      aria-current={selected || undefined}
      className={cn(
        "group bg-cream shadow-soft hover:shadow-raised hover:bg-lifted pressable focus-ring flex flex-col rounded-lg p-1.5 md:flex-row",
        selected && "shadow-ring hover:shadow-ring",
      )}
    >
      {photo && (
        <div className="relative aspect-4/3 shrink-0 overflow-hidden rounded-md md:w-2/5">
          <Photo
            src={photoSrc(photo.id, "large")}
            // The card's own text names it; the picture would only repeat that.
            alt=""
            color={photo.color || undefined}
            className="size-full"
            imgClassName="group-hover:scale-[1.02] transition-[opacity,transform] duration-slow"
          />
          <OutcomeChip outcome={attempt.outcome} className="shadow-soft absolute bottom-2 left-2" />
          {photos.length > 1 && (
            <span className="absolute top-2 right-2">
              <PhotoCountBadge count={photos.length} />
            </span>
          )}
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-2.5 px-2.5 pt-3 pb-2.5 md:px-4 md:py-3">
        {/* Without a photo, the outcome leads the card. */}
        {!photo && (
          <div className="flex items-center gap-2">
            <OutcomeChip outcome={attempt.outcome} />
            <Meta at={attempt.printedAt} time={time} person={person} via={via} />
          </div>
        )}
        <div className="flex items-baseline gap-2">
          <h3 className="text-body text-ink min-w-0 flex-1 font-sans">
            <MetaList>
              <span className={cn("break-words", name.titled ? "font-semibold" : "font-medium")}>{name.text}</span>
              <span className="text-small text-ink-faint font-medium whitespace-nowrap">attempt {index + 1}</span>
            </MetaList>
          </h3>
          {photo && <Meta at={attempt.printedAt} time={time} person={person} via={via} />}
        </div>
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
    </Link>
  );
});

function Meta({ at, time, person, via }: { at: number; time: string; person?: Person; via?: string }) {
  return (
    <span className="text-small text-ink-faint tabular ml-auto flex shrink-0 items-center gap-2 self-center pl-2">
      <time dateTime={new Date(at).toISOString()} title={fullTime(at)}>
        {time}
      </time>
      {person && <Avatar person={person} size="xs" via={via} />}
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
  if (entry.kind === "attempt") return null;
  const event = events[entry.kind];
  const EventIcon = event.icon;
  const photo = entryPhoto(entry, item);
  const name = itemName(item);
  const finished = entry.kind === "finished";
  return (
    <Link
      ref={ref}
      {...entryLink(entry, item)}
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
          className={cn(
            "shrink-0 rounded-md",
            finished ? "size-16" : "size-12",
            entry.kind === "shelved" && "opacity-75 saturate-50",
          )}
        />
      ) : (
        <span
          className={cn(
            "flex shrink-0 items-center justify-center rounded-md",
            finished ? "bg-basil-soft text-basil-ink size-16" : "bg-ink/5 text-ink-faint size-12",
          )}
        >
          <EventIcon size={finished ? 26 : 22} aria-hidden />
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <MetaList className="text-small">
          <span
            className={cn("flex items-center gap-1.5 font-semibold", finished ? "text-basil-ink" : "text-ink-faint")}
          >
            <EventIcon size={15} weight={finished ? "fill" : "regular"} aria-hidden />
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
        <span
          className={cn(
            "text-body truncate",
            name.titled ? "text-ink font-semibold" : "text-ink-soft font-medium",
            finished && "font-display text-title",
          )}
        >
          {name.text}
        </span>
      </span>
      {person && <Avatar person={person} size="xs" via={via} className="shrink-0" />}
    </Link>
  );
});
