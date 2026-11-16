import { type ComponentPropsWithRef, useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/cn";

interface ForFieldProps extends Omit<ComponentPropsWithRef<"input">, "type" | "id"> {
  /** Open although nobody is named yet, because "Someone else…" was picked (`ForOffer`): the field takes the focus. */
  asking?: boolean;
  /** The field took the focus: the page keeps it open and hides `ForOffer` until `onDone`. */
  onOpen?: () => void;
  /** The field lost the focus while empty: the page can put `ForOffer` back. */
  onDone?: () => void;
  /** It names the person reading: it reads "for you" until it is edited, when the name as typed shows. */
  you?: boolean;
}

/**
 * "for Mila": who an idea or build is for, quiet under the title. It reads as a line of text, also while edited: like
 * the title, it shows the caret and no focus ring.
 * Nobody named, it draws nothing: the page offers `ForOffer` among its chips, so a page without a name has no empty
 * field on it, and its "Someone else…" opens this line with the focus in it.
 */
export function ForField({
  className,
  asking = false,
  you = false,
  onOpen,
  onDone,
  onFocus,
  onBlur,
  ...props
}: ForFieldProps) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const empty = !String(props.value ?? props.defaultValue ?? "").trim();
  // "for you" as cards say it; the input keeps the name as typed underneath, and shows it while it has the focus.
  const showYou = you && !editing;

  useEffect(() => {
    if (asking) input.current?.focus();
  }, [asking]);

  if (empty && !asking) return null;
  return (
    <div className={cn("text-body flex items-baseline gap-1.5", className)}>
      <label htmlFor={id} className="text-ink-faint shrink-0">
        for
      </label>
      <span className="relative flex min-w-0 flex-1">
        <input
          ref={input}
          id={id}
          type="text"
          maxLength={80}
          autoComplete="off"
          placeholder="someone"
          className={cn(
            "placeholder:text-ink-faint min-w-0 flex-1 bg-transparent py-1 focus:shadow-none",
            showYou ? "text-transparent" : "text-ink",
          )}
          onFocus={(event) => {
            // Open from here on, so clearing the last letter to type another name keeps it (and the page hides the offer).
            setEditing(true);
            onOpen?.();
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setEditing(false);
            onBlur?.(event);
            if (!event.currentTarget.value.trim()) onDone?.();
          }}
          {...props}
        />
        {showYou && (
          <span
            aria-hidden
            className="text-ink pointer-events-none absolute inset-y-0 left-0 flex items-center font-semibold"
          >
            you
          </span>
        )}
      </span>
    </div>
  );
}

/** A "for …" line read-only, on a card or row: "for you" stands out a little (someone asked you), a name stays quiet. */
export function ForLine({ text }: { text: string }) {
  return text === "for you" ? <span className="text-ink font-semibold">{text}</span> : text;
}
