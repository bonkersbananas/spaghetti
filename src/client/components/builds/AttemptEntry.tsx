import type { Person } from "@shared/api";
import { tagLabel } from "@shared/attempts";
import { fullTime, relativeTime } from "@shared/time";
import { motion } from "motion/react";
import { forwardRef } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { CheckIcon, SameAgainIcon } from "@/components/ui/icons";
import { Photo } from "@/components/ui/Photo";
import { UploadBadge } from "@/components/ui/UploadBadge";
import { useTagOptions } from "@/lib/builds";
import { cn } from "@/lib/cn";
import type { AttemptView, PhotoView } from "@/lib/items";
import { spring } from "@/lib/motion";
import { photoSrc } from "@/lib/previews";
import { OutcomeChip, outcomeDots } from "./Outcome";
import { SettingsLine } from "./SettingsLine";
import { filamentLabel, formatMinutes, summarizeResults, summarizeSettings } from "./settings";

interface AttemptEntryProps {
  attempt: AttemptView;
  photos: PhotoView[];
  person?: Person;
  /** Highlighted by the arrow keys on desktop. */
  selected?: boolean;
  /** The newest entry: the timeline's line stops above the first one. */
  first?: boolean;
  last?: boolean;
  onOpen: () => void;
  /** For a printing attempt: open it to finish it. */
  onFinish?: () => void;
}

/**
 * One attempt in a build's story: how it went, what was tried differently
 * from the attempt before, its photos (large: prints are physical), tags,
 * and the settings in a line. Tapping it opens the attempt.
 */
export const AttemptEntry = forwardRef<HTMLLIElement, AttemptEntryProps>(function AttemptEntry(
  { attempt, photos, person, selected, first, last, onOpen, onFinish },
  ref,
) {
  const failureOptions = useTagOptions("failure");
  const successOptions = useTagOptions("success");
  const printing = attempt.outcome === null;
  const settings = summarizeSettings(attempt.settings);
  const results = summarizeResults(attempt.settings);
  const filaments = attempt.settings.filaments ?? [];
  const [lead, ...rest] = photos;

  return (
    <motion.li
      ref={ref}
      layout="position"
      initial={attempt.pending ? { opacity: 0, y: -10 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={spring.gentle}
      className="relative flex list-none gap-3.5 md:gap-4"
      aria-current={selected || undefined}
    >
      {/* The thread of the story: a dot in the outcome's color on a quiet line. */}
      <div className="relative flex w-3 shrink-0 justify-center" aria-hidden>
        <span className={cn("bg-ink/10 absolute w-0.5", first ? "top-6" : "top-0", last ? "h-6" : "bottom-0")} />
        <span
          className={cn(
            "ring-paper relative mt-5 size-3 rounded-full ring-4",
            outcomeDots[attempt.outcome ?? "printing"],
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
            aria-label={`Attempt ${attempt.number}: ${printing ? "printing" : attempt.outcome}. Open`}
            className="focus-ring absolute inset-0 z-0 rounded-lg"
          />
          <div className="pointer-events-none relative flex flex-col gap-3 p-3.5 md:p-4">
            <div className="flex items-center gap-2.5">
              <OutcomeChip outcome={attempt.outcome} />
              <h3 className="text-body text-ink font-sans font-semibold">Attempt {attempt.number}</h3>
              <span className="text-small text-ink-faint ml-auto flex items-center gap-2">
                <time dateTime={new Date(attempt.printedAt).toISOString()} title={fullTime(attempt.printedAt)}>
                  {relativeTime(attempt.printedAt)}
                </time>
                {person && <Avatar person={person} size="xs" />}
              </span>
            </div>

            {attempt.changes.length > 0 && (
              <p className="text-small text-ink-soft flex items-start gap-1.5">
                <SameAgainIcon size={16} className="text-semolina-ink mt-0.5 shrink-0" aria-hidden />
                <span>
                  <span className="sr-only">Changed since attempt {attempt.number - 1}: </span>
                  {attempt.changes.map((change, index) => (
                    <span key={change.key}>
                      {index > 0 && <span className="text-ink-ghost"> · </span>}
                      <span className="bg-semolina-soft/70 text-ink inline-block max-w-full rounded-xs px-1 font-medium whitespace-nowrap">
                        {change.text}
                      </span>
                    </span>
                  ))}
                </span>
              </p>
            )}

            {attempt.note && <p className="text-body text-ink break-words">{attempt.note}</p>}

            {lead && (
              <div className={cn("flex gap-2", rest.length > 0 ? "md:max-w-xl" : "md:max-w-md")}>
                <EntryPhoto
                  photo={lead}
                  alt={`Attempt ${attempt.number}`}
                  variant="large"
                  className="aspect-4/3 min-w-0 flex-3"
                />
                {rest.length > 0 && (
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
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

            {printing && onFinish && (
              <div className="pointer-events-auto flex items-center gap-3">
                <span className="text-small text-ink-soft">
                  {attempt.settings.estimatedMinutes
                    ? `Should be done ${doneBy(attempt.printedAt, attempt.settings.estimatedMinutes)}`
                    : "On the bed now"}
                </span>
                <Button size="sm" variant="secondary" onClick={onFinish} className="ml-auto">
                  Finish
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.li>
  );
});

/** "around 16:40", or "in about 45 min" when it's close. */
function doneBy(startedAt: number, minutes: number): string {
  const end = startedAt + minutes * 60_000;
  const left = end - Date.now();
  if (left <= 0) return "by now";
  if (left < 90 * 60_000) return `in about ${formatMinutes(Math.max(1, left / 60_000))}`;
  return `around ${new Date(end).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
}

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
