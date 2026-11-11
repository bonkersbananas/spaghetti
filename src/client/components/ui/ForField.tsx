import { type ComponentPropsWithRef, useEffect, useId, useRef } from "react";
import { cn } from "@/lib/cn";
import { ToggleChip } from "./Chip";

interface ForFieldProps extends Omit<ComponentPropsWithRef<"input">, "type" | "id"> {
  /** Open although nobody is named yet, because `ForChip` was tapped: the field takes the focus. */
  asking?: boolean;
  /** The field took the focus: the page keeps it open and hides `ForChip` until `onDone`. */
  onOpen?: () => void;
  /** The field lost the focus while empty: the page can put `ForChip` back. */
  onDone?: () => void;
}

/**
 * "for Mila": who an idea or build is for, quiet under the title. It reads as a line of text until it is edited.
 * Nobody named, it draws nothing: the page offers `ForChip` among its chips, so a page without a name has no empty
 * field on it, and tapping the chip opens this line with the focus in it.
 */
export function ForField({ className, asking = false, onOpen, onDone, onFocus, onBlur, ...props }: ForFieldProps) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const empty = !String(props.value ?? props.defaultValue ?? "").trim();

  useEffect(() => {
    if (asking) input.current?.focus();
  }, [asking]);

  if (empty && !asking) return null;
  return (
    <div className={cn("text-body flex items-baseline gap-1.5", className)}>
      <label htmlFor={id} className="text-ink-faint shrink-0">
        for
      </label>
      <input
        ref={input}
        id={id}
        type="text"
        maxLength={80}
        autoComplete="off"
        placeholder="someone"
        className="text-ink placeholder:text-ink-faint focus-visible:shadow-ring min-w-0 flex-1 rounded-sm bg-transparent py-1"
        onFocus={(event) => {
          // Open from here on, so clearing the last letter to type another name keeps it (and the page hides the chip).
          onOpen?.();
          onFocus?.(event);
        }}
        onBlur={(event) => {
          onBlur?.(event);
          if (!event.currentTarget.value.trim()) onDone?.();
        }}
        {...props}
      />
    </div>
  );
}

/** The quiet "For someone…" chip that opens an empty `ForField`. Shown only while nobody is named and it can be edited. */
export function ForChip({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <ToggleChip disabled={disabled} onClick={onClick}>
      For someone
    </ToggleChip>
  );
}
