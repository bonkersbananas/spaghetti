import { m } from "motion/react";
import { type ReactNode, useState } from "react";
import { cn } from "@/lib/cn";
import { tap } from "@/lib/haptics";
import { spring } from "@/lib/motion";
import { CheckIcon } from "./icons";

/** The surface a checklist's rows sit on: one soft card, rows told apart by an inset hairline. */
export const checklistSurface = "bg-cream shadow-soft rounded-lg";

interface TickBoxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** What ticking it means, with the thing's name: "Bought: Liquid glue". */
  label: string;
  disabled?: boolean;
  className?: string;
}

/**
 * A round box to tick something off: a ring while open, a basil disc with a check once done. The check springs in
 * when it's ticked here (and the phone gives a small buzz); a tick that arrives from elsewhere is just there. A 44 px
 * target around a 24 px circle.
 */
export function TickBox({ checked, onChange, label, disabled, className }: TickBoxProps) {
  // Only a tick made here springs in; one that loads ticked doesn't move.
  const [ticked, setTicked] = useState(false);
  return (
    // biome-ignore lint/a11y/useSemanticElements: a round box drawn as a button, with the checkbox role and state.
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => {
        if (!checked) {
          setTicked(true);
          tap();
        }
        onChange(!checked);
      }}
      className={cn(
        "group/tick focus-ring press-none flex size-11 shrink-0 items-center justify-center rounded-full disabled:opacity-60",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "duration-fast flex size-6 items-center justify-center rounded-full transition-colors",
          checked
            ? "bg-basil-soft text-basil-ink ring-basil/40 ring-2 ring-inset"
            : "ring-ink/55 group-hover/tick:ring-ink/75 pointer-fine:group-active/tick:bg-ink/8 ring-2 ring-inset",
        )}
      >
        {checked && (
          <m.span
            initial={ticked ? { scale: 0.5, opacity: 0 } : false}
            animate={{ scale: 1, opacity: 1 }}
            transition={spring.snappy}
            className="flex"
          >
            <CheckIcon size={14} weight="bold" />
          </m.span>
        )}
      </span>
    </button>
  );
}

interface ChecklistRowProps {
  /** The TickBox. */
  tick: ReactNode;
  /** A small picture of the thing (Thumb), between the tick box and the name, from `sm` (a phone's line is the name's). Only when there is one: no empty tile. */
  thumb?: ReactNode;
  /**
   * Some row of the list has a picture: a row without one keeps the picture's room empty (from `sm`), so every name
   * starts at the same edge. Room, not a tile: nothing is drawn there.
   */
  pictureRoom?: boolean;
  /** The name, usually a `ChecklistName` that opens the thing. */
  children: ReactNode;
  /** What sits at the line's end, quiet: the price found, who got it and when. */
  aside?: ReactNode;
  /** A second line under the name, only for something to do there ("Add to pantry"). */
  meta?: ReactNode;
  /** The DragHandle, last on the line. */
  handle?: ReactNode;
  /** Ticked off: the name steps back. */
  done?: boolean;
  /** Picked up and moving: it floats over the others. */
  lifted?: boolean;
  /** The last row has no hairline under it. */
  last?: boolean;
  className?: string;
}

/**
 * One line of a checklist (the shopping list): the tick box, a picture only when the thing has one, the name on one
 * line (cut with an ellipsis; the whole of it is a tap away), something quiet at the line's end and a drag handle.
 * Rows sit on `checklistSurface`, an inset hairline between them; a lifted row floats on `shadow-float` while it
 * moves.
 */
export function ChecklistRow({
  tick,
  thumb,
  pictureRoom,
  children,
  aside,
  meta,
  handle,
  done,
  lifted,
  last,
  className,
}: ChecklistRowProps) {
  return (
    <div
      data-done={done || undefined}
      data-lifted={lifted || undefined}
      className={cn(
        "after:bg-hairline relative flex flex-col rounded-lg py-0.5 pl-1.5 after:absolute after:right-4 after:bottom-0 after:left-14 after:h-px",
        // A row without a handle keeps its last words off the card's edge.
        handle ? "pr-1 md:pr-2" : "pr-4",
        (lifted || last) && "after:hidden",
        lifted && "bg-lifted shadow-float z-10",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-1 md:gap-2">
        {tick}
        {/* On a phone the line is the name's: the picture waits for the thing's sheet. */}
        {thumb ? (
          <div className="hidden shrink-0 pr-1 sm:flex">{thumb}</div>
        ) : (
          pictureRoom && <div aria-hidden className="box-content hidden size-8 shrink-0 pr-1 sm:block" />
        )}
        <div className={cn("min-w-0 flex-1", done && "text-ink-faint")}>{children}</div>
        {aside && <div className="text-small text-ink-faint flex shrink-0 items-center gap-1.5 pl-2">{aside}</div>}
        {handle}
      </div>
      {meta && (
        // Starts where the name does: past the tick box, and the picture's room when there is one.
        <div
          className={cn(
            "flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 pb-1.5 pl-12 md:pl-13",
            (!!thumb || pictureRoom) && "sm:pl-21 md:pl-24",
          )}
        >
          {meta}
        </div>
      )}
    </div>
  );
}

interface ChecklistNameProps {
  /** The whole name: the line shows what fits, with an ellipsis, and the title holds the rest for a pointer. */
  children: string;
  onOpen: () => void;
  done?: boolean;
}

/** A checklist row's name: one line, a button that opens the thing (where its whole name is). */
export function ChecklistName({ children, onOpen, done }: ChecklistNameProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      title={children}
      className={cn(
        "focus-ring touch-target hover:decoration-ink/25 text-body relative -mx-1 block max-w-full truncate rounded-xs px-1 py-1.5 text-left hover:underline hover:underline-offset-4",
        done ? "text-ink-faint decoration-ink/30 line-through" : "text-ink font-semibold",
      )}
    >
      {children}
    </button>
  );
}
