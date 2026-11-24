import type { Person } from "@shared/api";
import { tagLabel } from "@shared/attempts";
import { fullTime, relativeTime } from "@shared/time";
import { m } from "motion/react";
import { forwardRef, type KeyboardEvent } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { ChangeLine } from "@/components/ui/ChangeLine";
import { ExpandIcon } from "@/components/ui/icons";
import { OpenLarge, openLarge } from "@/components/ui/OpenLarge";
import { Photo } from "@/components/ui/Photo";
import { rowHover, rowSelected } from "@/components/ui/PhotoRow";
import { PrinterMark } from "@/components/ui/PrinterMark";
import { useTagOptions } from "@/lib/builds";
import { cn } from "@/lib/cn";
import type { AttemptView, PhotoView } from "@/lib/items";
import { spring } from "@/lib/motion";
import { fileThumbSrc, photoSrc } from "@/lib/previews";
import { attemptLarge } from "./AttemptEntry";
import { AttemptMenu } from "./AttemptMenu";
import { OutcomeChip, outcomeDots, outcomeIcons, stepOf } from "./Outcome";
import { PlateThumb } from "./SlicerFile";

interface AttemptRowProps {
  attempt: AttemptView;
  photos: PhotoView[];
  person?: Person;
  /** Picked by the arrow keys (J/K) or focused: drawn as the picked row. */
  selected?: boolean;
  /** The oldest attempt: the story's thread stops at its dot. */
  last?: boolean;
  /** Opens the row in place into the attempt's full card. */
  onExpand: () => void;
  /** The card's "…" menu, here too: compare it with the attempt before, keep it as a recipe, move it. */
  onCompare?: () => void;
  onSaveRecipe?: () => void;
  onMove?: () => void;
}

/**
 * An earlier attempt in a build's story, folded to one compact row on the same thread as the cards: its picture (which
 * opens large), how it went, its number and when, the one line that matters (its note, else what went wrong, else what
 * worked) and what it changed from the attempt before. A tap, a click, Enter or Space opens it in place into the full
 * card (`AttemptEntry`). The newest attempt, a print still on the bed and one the printer asks about stay cards.
 */
export const AttemptRow = forwardRef<HTMLLIElement, AttemptRowProps>(function AttemptRow(
  { attempt, photos, person, selected, last, onExpand, onCompare, onSaveRecipe, onMove },
  ref,
) {
  const failureOptions = useTagOptions("failure");
  const successOptions = useTagOptions("success");
  const step = stepOf(attempt);
  const [lead] = photos;
  const outcome = attempt.outcome ?? "failed";
  const Icon = outcomeIcons[outcome];
  // The one line that matters: what someone wrote, else what went wrong, else what worked.
  const line = attempt.note.trim()
    ? attempt.note.trim()
    : attempt.failureTags.length
      ? attempt.failureTags.map((slug) => tagLabel("failure", slug, failureOptions)).join(" · ")
      : attempt.successNotes.length
        ? attempt.successNotes.map((slug) => tagLabel("success", slug, successOptions)).join(" · ")
        : null;
  // Enter opens the row here, before the page's Enter (open the picked attempt's sheet) can take it.
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    onExpand();
  };
  const when = (
    <time dateTime={new Date(attempt.printedAt).toISOString()} title={fullTime(attempt.printedAt)}>
      {relativeTime(attempt.printedAt)}
    </time>
  );

  return (
    <m.li
      ref={ref}
      layout="position"
      transition={spring.gentle}
      className="relative flex list-none gap-3.5 md:gap-4"
      aria-current={selected || undefined}
      data-attempt-id={attempt.id}
      data-attempt-row=""
    >
      {/* The story's thread, its dot on the chip's line as the card's is, so it stays put when the row opens. */}
      <div className="relative flex w-3 shrink-0 justify-center" aria-hidden>
        <span className={cn("bg-ink/10 absolute top-0 w-0.5", last ? "h-6" : "bottom-0")} />
        <span className={cn("ring-paper relative mt-5 size-3 rounded-full ring-4", outcomeDots[step])} />
      </div>

      <div className="min-w-0 flex-1 pb-2 md:pb-3">
        <div className={cn("duration-fast relative rounded-lg transition-colors", selected ? rowSelected : rowHover)}>
          <button
            type="button"
            onClick={onExpand}
            onKeyDown={onKeyDown}
            aria-expanded={false}
            aria-label={`Attempt ${attempt.number}: ${attempt.outcome ?? "no answer"}. Expand`}
            className="pressable focus-ring absolute inset-0 z-0 rounded-lg"
          />
          <div className="pointer-events-none relative flex items-start gap-3.5 px-3.5 pt-3 pb-2 md:gap-4 md:px-4">
            {lead ? (
              <OpenLarge
                label={
                  photos.length > 1
                    ? `Open attempt ${attempt.number}'s pictures large`
                    : `Open attempt ${attempt.number}'s picture large`
                }
                className="pointer-events-auto relative z-10 size-12 shrink-0 rounded-md md:size-16"
                data-photo-id={lead.id}
                onClick={(event) => openLarge(event, attemptLarge(attempt, photos, person, 0))}
              >
                <Photo src={photoSrc(lead.id, "thumb")} alt="" color={lead.color || undefined} className="size-full" />
                {photos.length > 1 && (
                  <span className="bg-veil text-on-veil text-caption tabular rounded-pill absolute right-1 bottom-1 px-1.5 leading-5 font-semibold">
                    +{photos.length - 1}
                  </span>
                )}
              </OpenLarge>
            ) : attempt.file?.hasThumb ? (
              // No photo, but the plate it printed: the slicer's picture of it.
              <PlateThumb src={fileThumbSrc(attempt.file)} alt="" className="size-12 md:size-16" />
            ) : (
              <span
                aria-hidden
                // Neutral: the chip and the thread's dot already say how it went, and a row stays quieter than the card.
                className="bg-ink/4 text-ink-faint flex size-12 shrink-0 items-center justify-center rounded-md md:size-16"
              >
                <Icon size={22} weight="bold" />
              </span>
            )}
            <div className="flex min-w-0 flex-1 flex-col gap-1 py-0.5">
              <div className="flex items-center gap-2 md:gap-2.5">
                <OutcomeChip outcome={attempt.outcome} />
                <h3 className="text-body text-ink flex items-center gap-1.5 font-sans font-semibold whitespace-nowrap">
                  Attempt {attempt.number}
                  {/* It opens: the caret the card's name has, pointing down. */}
                  <ExpandIcon size={16} aria-hidden className="text-ink-faint shrink-0" />
                </h3>
                {/* Who printed it and when, where the card has them on desktop; a phone's row has room for neither (when goes under). */}
                <span className="text-small text-ink-faint ml-auto flex min-w-0 items-center gap-2 whitespace-nowrap">
                  <span className="hidden min-w-0 truncate md:inline">{when}</span>
                  <span className="hidden md:flex">
                    {attempt.fromPrinter ? (
                      <PrinterMark size="xs" decorative />
                    ) : (
                      person && <Avatar person={person} size="xs" />
                    )}
                  </span>
                </span>
                {/* Above the row's button, so it works. */}
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
              {/* In the card's order: what it changed, then the words. */}
              <ChangeLine changes={attempt.changes} label={`Changed since attempt ${attempt.number - 1}: `} />
              {/* Phones say when at the start of this line (the first has no room for it), and give the note three lines. */}
              <p
                className={cn(
                  "text-small line-clamp-3 min-w-0 text-pretty break-words md:line-clamp-1",
                  !line && "md:hidden",
                )}
              >
                <span className="text-ink-faint md:hidden">
                  {when}
                  {line && " · "}
                </span>
                {line && <span className="text-ink-soft">{line}</span>}
              </p>
            </div>
          </div>
        </div>
      </div>
    </m.li>
  );
});
