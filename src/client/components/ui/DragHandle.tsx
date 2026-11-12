import type { KeyboardEvent, PointerEvent, Ref } from "react";
import { cn } from "@/lib/cn";
import { DragIcon } from "./icons";

interface DragHandleProps {
  /** "Move Tugboat": what it moves. */
  label: string;
  /** Starts a drag (pointer, mouse or touch); the list follows the finger. */
  onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
  /** Arrow keys move it a place up (-1) or down (+1). */
  onMove: (step: -1 | 1) => void;
  /** Delete or Backspace takes it off (with an undo). */
  onRemove?: () => void;
  disabled?: boolean;
  /** `row` is as tall as a wishlist row; `line` a 44 px square for a checklist line. */
  size?: "row" | "line";
  ref?: Ref<HTMLButtonElement>;
}

/**
 * The grip a row is dragged by: six dots, a 44 px target that doesn't scroll the page under a finger
 * (`touch-none`). With the keyboard, the arrow keys move the row and focus stays on it.
 */
export function DragHandle({ label, onPointerDown, onMove, onRemove, disabled, ref, size = "row" }: DragHandleProps) {
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();
      onMove(event.key === "ArrowUp" ? -1 : 1);
    } else if (onRemove && (event.key === "Delete" || event.key === "Backspace")) {
      event.preventDefault();
      event.stopPropagation();
      onRemove();
    }
  }
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={onRemove ? `${label} (↑ ↓, Delete removes)` : `${label} (↑ ↓)`}
      aria-keyshortcuts={onRemove ? "ArrowUp ArrowDown Delete" : "ArrowUp ArrowDown"}
      aria-roledescription="drag handle"
      disabled={disabled}
      onPointerDown={disabled ? undefined : onPointerDown}
      onKeyDown={disabled ? undefined : onKeyDown}
      className={cn(
        "focus-ring text-ink-faint hover:text-ink-soft hover:bg-ink/5 active:bg-ink/8 disabled:text-ink-ghost flex shrink-0 cursor-grab touch-none items-center justify-center rounded-md transition-colors select-none active:cursor-grabbing disabled:cursor-not-allowed",
        size === "row" ? "h-14 w-11 md:h-16 md:w-9" : "size-11",
      )}
    >
      <DragIcon size={20} weight="bold" aria-hidden />
    </button>
  );
}
