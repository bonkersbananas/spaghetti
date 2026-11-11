import { m } from "motion/react";
import { type KeyboardEvent, type PointerEvent, type ReactNode, type Ref, useState } from "react";
import { cn } from "@/lib/cn";
import { tap } from "@/lib/haptics";
import { spring } from "@/lib/motion";
import { CheckIcon, DragIcon } from "./icons";

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
            : "ring-ink/25 group-hover/tick:ring-ink/45 group-active/tick:bg-ink/8 ring-2 ring-inset",
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

interface DragHandleProps {
  /** "Move Liquid glue": what it moves. */
  label: string;
  /** Starts a drag (mouse or finger); the list follows. */
  onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
  /** The arrow keys move it a place up (-1) or down (+1); focus stays on it. */
  onMove: (step: -1 | 1) => void;
  disabled?: boolean;
  ref?: Ref<HTMLButtonElement>;
  className?: string;
}

/**
 * The grip a row is dragged by: six dots in a 44 px target that doesn't scroll the page under a finger
 * (`touch-none`). With the keyboard, Up and Down move the row a place.
 */
export function DragHandle({ label, onPointerDown, onMove, disabled, ref, className }: DragHandleProps) {
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    event.stopPropagation();
    onMove(event.key === "ArrowUp" ? -1 : 1);
  }
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      aria-keyshortcuts="ArrowUp ArrowDown"
      title="Drag, or use the arrow keys"
      disabled={disabled}
      onPointerDown={disabled ? undefined : onPointerDown}
      onKeyDown={disabled ? undefined : onKeyDown}
      className={cn(
        "text-ink-faint hover:text-ink-soft focus-ring press-none flex size-11 shrink-0 cursor-grab touch-none items-center justify-center rounded-md select-none active:cursor-grabbing disabled:cursor-default disabled:opacity-40",
        className,
      )}
    >
      <DragIcon size={20} weight="bold" aria-hidden />
    </button>
  );
}

interface ChecklistRowProps {
  /** The TickBox. */
  tick: ReactNode;
  /** The name, usually a button that opens the thing. */
  children: ReactNode;
  /** A line under the name: links (LinkChip), who and when. */
  meta?: ReactNode;
  /** The DragHandle, last, under the thumb. */
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
 * One line of a checklist (the shopping list): the tick box, the name with a line of links or detail under it, and a
 * drag handle. Rows sit on `checklistSurface`, an inset hairline between them; a lifted row floats on
 * `shadow-float` while it moves.
 */
export function ChecklistRow({ tick, children, meta, handle, done, lifted, last, className }: ChecklistRowProps) {
  return (
    <div
      data-done={done || undefined}
      data-lifted={lifted || undefined}
      className={cn(
        "after:bg-hairline relative flex items-start gap-1 rounded-lg py-1.5 pr-1 pl-1.5 after:absolute after:right-4 after:bottom-0 after:left-14 after:h-px md:gap-2 md:pr-2",
        (lifted || last) && "after:hidden",
        lifted && "bg-lifted shadow-float z-10",
        className,
      )}
    >
      {tick}
      <div className="flex min-w-0 flex-1 flex-col gap-1 py-1">
        <div className={cn("min-w-0", done && "text-ink-faint")}>{children}</div>
        {meta && <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">{meta}</div>}
      </div>
      {handle}
    </div>
  );
}
