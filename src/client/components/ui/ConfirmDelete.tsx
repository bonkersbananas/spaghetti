import { useEffect, useRef } from "react";
import { Button, IconButton } from "./Button";
import { TrashIcon } from "./icons";

interface ConfirmDeleteProps {
  /** Whether the question is showing: the page owns it, so a key can ask too. */
  asking: boolean;
  onAskingChange: (asking: boolean) => void;
  /** Does it (the Undo toast follows). */
  onConfirm: () => void;
  /** What goes, in the question: "idea" gives "Delete this idea?". */
  what: string;
  /** "Delete", or "Scrap" for a build that goes back to Ideas. */
  verb?: string;
  disabled?: boolean;
  /** The trash can's hover text, with its key. */
  title?: string;
  ariaKeyshortcuts?: string;
}

/**
 * Deletes an idea or a build in two steps, in place (decision 0063, after 0054's photo X): the trash can turns into
 * "Delete this idea?" with a tomato "Delete" and a "Keep" to go back, where it sits. Enter confirms, Escape, a tap
 * elsewhere and "Keep" back out. No dialog; the Undo toast still follows. The page owns `asking`, so ⌘⌫ can ask too.
 */
export function ConfirmDelete({
  asking,
  onAskingChange,
  onConfirm,
  what,
  verb = "Delete",
  disabled,
  title,
  ariaKeyshortcuts,
}: ConfirmDeleteProps) {
  const root = useRef<HTMLSpanElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  const latest = useRef({ onConfirm, onAskingChange });
  latest.current = { onConfirm, onAskingChange };

  useEffect(() => {
    if (!asking) return;
    confirm.current?.focus({ preventScroll: true });
    const away = (event: Event) => {
      if (!root.current?.contains(event.target as Node)) latest.current.onAskingChange(false);
    };
    // Before the screen's own keys: Escape only backs out of the question, and Enter confirms it, not "open the attempt".
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        latest.current.onAskingChange(false);
      } else if (event.key === "Enter" && !event.isComposing) {
        event.stopPropagation();
        event.preventDefault();
        latest.current.onAskingChange(false);
        latest.current.onConfirm();
      }
    };
    document.addEventListener("pointerdown", away, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", away, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [asking]);

  if (!asking) {
    return (
      <IconButton
        icon={TrashIcon}
        label={`${verb} ${what}`}
        title={title ?? `${verb} ${what}`}
        onClick={() => onAskingChange(true)}
        disabled={disabled}
        aria-keyshortcuts={ariaKeyshortcuts}
      />
    );
  }
  return (
    <span ref={root} className="flex items-center gap-1.5">
      <span className="text-small text-ink font-semibold">
        {verb} this {what}?
      </span>
      <Button size="sm" variant="quiet" onClick={() => onAskingChange(false)}>
        Keep
      </Button>
      <Button
        ref={confirm}
        size="sm"
        variant="primary"
        icon={TrashIcon}
        onClick={() => {
          onAskingChange(false);
          onConfirm();
        }}
      >
        {verb}
      </Button>
      <span role="status" className="sr-only">
        Enter confirms, Escape keeps it.
      </span>
    </span>
  );
}
