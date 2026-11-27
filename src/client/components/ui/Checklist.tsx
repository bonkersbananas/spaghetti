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
  /**
   * The thing's colour where it has one (a `SpoolDisc`, `sm`), before the name at every width: the spool to take off the
   * shelf. Takes the picture's place.
   */
  swatch?: ReactNode;
  /**
   * The thing's picture (a 48 px `Thumb`) before the name, from `sm` (a phone's line is the name's). Only when there is
   * one: no empty tile, and no room kept for it on the rows without.
   */
  thumb?: ReactNode;
  /** The name, usually a `ChecklistName` that opens the thing. */
  children: ReactNode;
  /** What sits at the end of the name's first line, quiet: the price found, who got it and when. */
  aside?: ReactNode;
  /** A line under the name, only for something to do there ("Add to pantry"). */
  meta?: ReactNode;
  /** The DragHandle, last, level with the name's first line. */
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
 * One row of a checklist (the shopping list): the tick box, the thing's colour or picture when it has one, the name
 * (one line, or two balanced ones for a long name, then an ellipsis; the whole of it is a tap away), something quiet at
 * the end of its first line and a drag handle; tick box, aside and handle stay level with the first line. Rows sit
 * on `checklistSurface`, an inset hairline between them; a lifted row floats on `shadow-float` while it moves.
 */
export function ChecklistRow({
  tick,
  swatch,
  thumb,
  children,
  aside,
  meta,
  handle,
  done,
  lifted,
  last,
  className,
}: ChecklistRowProps) {
  const picture = !swatch && thumb;
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
      {/* Every piece is a 44 px line tall and centred on it, so all of them sit level with the name's first line. */}
      <div className="flex min-w-0 items-start gap-1 md:gap-2">
        {tick}
        {swatch && <div className="flex h-11 shrink-0 items-center pr-1">{swatch}</div>}
        {picture && <div className="-my-0.5 hidden h-12 shrink-0 items-center pr-1 sm:flex">{thumb}</div>}
        <div className={cn("min-w-0 flex-1 py-1", done && "text-ink-faint")}>{children}</div>
        {aside && <div className="text-small text-ink-faint flex h-11 shrink-0 items-center gap-1.5 pl-2">{aside}</div>}
        {handle}
      </div>
      {meta && (
        // Starts where the name does: past the tick box, and the colour or picture when there is one.
        <div
          className={cn(
            "flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 pb-1.5",
            swatch ? "pl-20 md:pl-22" : picture ? "pl-12 sm:pl-26 md:pl-28" : "pl-12 md:pl-13",
          )}
        >
          {meta}
        </div>
      )}
    </div>
  );
}

interface ChecklistNameProps {
  /** The whole name: the row shows two lines of it at most, with an ellipsis, and the title holds it all for a pointer. */
  children: string;
  onOpen: () => void;
  done?: boolean;
}

/** A checklist row's name: a button that opens the thing (where its whole name is), on two balanced lines at most. */
export function ChecklistName({ children, onOpen, done }: ChecklistNameProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      title={children}
      className={cn(
        "focus-ring touch-target hover:decoration-ink/25 text-body relative -mx-1 block max-w-full rounded-xs px-1 py-1.5 text-left hover:underline hover:underline-offset-4",
        done ? "text-ink-faint decoration-ink/30 line-through" : "text-ink font-semibold",
      )}
    >
      {/* The clamp clips its own box only: the button's 44 px touch target is drawn outside it. */}
      <span className="line-clamp-2 text-balance break-words">{children}</span>
    </button>
  );
}
