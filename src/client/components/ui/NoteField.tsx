import { useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { linkify } from "@/lib/linkify";
import { TextArea } from "./Field";

interface NoteFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  /** Shown as text only, with its links: no way to start editing (offline, for saved notes). */
  readOnly?: boolean;
  className?: string;
}

/**
 * A note that reads as text, with its links clickable, and turns into a
 * growing textarea when you tap or click it (Escape or leaving it turns it
 * back). Pairs with autosave: there is no save button.
 */
export function NoteField({
  value,
  onChange,
  placeholder = "Add a note…",
  label = "Note",
  readOnly,
  className,
}: NoteFieldProps) {
  const [editing, setEditing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  if (readOnly && !value.trim()) return null;
  if (!readOnly && (editing || !value.trim())) {
    return (
      <TextArea
        ref={(el) => {
          textareaRef.current = el;
          if (el && editing && document.activeElement !== el) {
            el.focus();
            el.setSelectionRange(el.value.length, el.value.length);
          }
        }}
        appearance="plain"
        aria-label={label}
        placeholder={placeholder}
        minRows={2}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={() => setEditing(false)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.blur();
          }
        }}
        className={className}
      />
    );
  }

  return (
    <div className={cn("relative", className)}>
      {/* The whole note is a button to start editing; links sit above it and stay clickable. */}
      {!readOnly && (
        <button
          type="button"
          aria-label={`Edit ${label.toLowerCase()}`}
          onClick={() => setEditing(true)}
          className="focus-ring absolute -inset-1.5 cursor-text rounded-sm"
        />
      )}
      <p className="text-lead text-ink md:text-body pointer-events-none relative break-words whitespace-pre-wrap">
        {linkify(
          value,
          "pointer-events-auto text-ink underline decoration-ink-ghost decoration-1 underline-offset-3 hover:decoration-ink focus-ring rounded-xs",
        )}
      </p>
    </div>
  );
}
