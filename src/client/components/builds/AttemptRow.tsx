import type { Person } from "@shared/api";
import { tagLabel } from "@shared/attempts";
import { fullTime, relativeTime } from "@shared/time";
import { m } from "motion/react";
import { forwardRef, type KeyboardEvent } from "react";
import { ChangeLine } from "@/components/ui/ChangeLine";
import { OpenLarge, openLarge } from "@/components/ui/OpenLarge";
import { Photo } from "@/components/ui/Photo";
import { rowHover, rowSelected } from "@/components/ui/PhotoRow";
import { useTagOptions } from "@/lib/builds";
import { cn } from "@/lib/cn";
import type { AttemptView, PhotoView } from "@/lib/items";
import { spring } from "@/lib/motion";
import { photoSrc } from "@/lib/previews";
import { attemptLarge } from "./AttemptEntry";
import { AttemptMenu } from "./AttemptMenu";
import { OutcomeChip, outcomeDots, outcomeIcons, stepOf } from "./Outcome";

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

/** The face of a row without a photo: its outcome's icon on the outcome's soft tone, as the summary's trail draws it. */
const tileTones = {
  success: "bg-basil-soft text-basil-ink",
  partial: "bg-semolina-soft text-semolina-ink",
  failed: "bg-tomato-soft text-tomato-ink",
} as const;

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
    ? { text: attempt.note.trim(), className: "text-ink-soft" }
    : attempt.failureTags.length
      ? {
          text: attempt.failureTags.map((slug) => tagLabel("failure", slug, failureOptions)).join(" · "),
          className: "text-tomato-ink",
        }
      : attempt.successNotes.length
        ? {
            text: attempt.successNotes.map((slug) => tagLabel("success", slug, successOptions)).join(" · "),
            className: "text-basil-ink",
          }
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
      {/* The story's thread, its dot level with the row's picture. */}
      <div className="relative flex w-3 shrink-0 justify-center" aria-hidden>
        <span className={cn("bg-ink/10 absolute top-0 w-0.5", last ? "h-9 md:h-10" : "bottom-0")} />
        <span className={cn("ring-paper relative mt-7.5 size-3 rounded-full ring-4 md:mt-8.5", outcomeDots[step])} />
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
          <div className="pointer-events-none relative flex items-start gap-3.5 p-2 md:gap-4">
            {lead ? (
              <OpenLarge
                label={
                  photos.length > 1
                    ? `Open attempt ${attempt.number}'s pictures large`
                    : `Open attempt ${attempt.number}'s picture large`
                }
                className="pointer-events-auto relative z-10 size-14 shrink-0 rounded-md md:size-16"
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
            ) : (
              <span
                aria-hidden
                className={cn(
                  "flex size-14 shrink-0 items-center justify-center rounded-md md:size-16",
                  tileTones[outcome],
                )}
              >
                <Icon size={22} weight="bold" />
              </span>
            )}
            <div className="flex min-w-0 flex-1 flex-col gap-1 py-0.5">
              <div className="flex items-center gap-2.5">
                <OutcomeChip outcome={attempt.outcome} />
                <h3 className="text-body text-ink font-sans font-semibold whitespace-nowrap">
                  Attempt {attempt.number}
                </h3>
                <span className="text-small text-ink-faint ml-auto hidden min-w-0 truncate whitespace-nowrap md:inline">
                  {when}
                </span>
                {/* Above the row's button, so it works. */}
                <span className="pointer-events-auto relative z-10 -my-1.5 flex shrink-0 max-md:ml-auto">
                  <AttemptMenu
                    number={attempt.number}
                    onCompare={onCompare}
                    onSaveRecipe={onSaveRecipe}
                    onMove={onMove}
                    changed={attempt.changes.length > 0}
                  />
                </span>
              </div>
              {/* Phones say when at the start of this line (the first has no room for it), and give it two lines. */}
              <p className={cn("text-small line-clamp-2 min-w-0 break-words md:line-clamp-1", !line && "md:hidden")}>
                <span className="text-ink-faint md:hidden">
                  {when}
                  {line && " · "}
                </span>
                {line && <span className={line.className}>{line.text}</span>}
              </p>
              <ChangeLine
                changes={attempt.changes}
                label={`Changed since attempt ${attempt.number - 1}: `}
                className="mt-0.5"
              />
            </div>
          </div>
        </div>
      </div>
    </m.li>
  );
});
