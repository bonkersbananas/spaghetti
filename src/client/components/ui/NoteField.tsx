import { findLinks, isLink } from "@shared/links";
import { type ModelMark, sameModel, tidyModelLinks, withoutModelLines } from "@shared/model-mark";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { linkify } from "@/lib/linkify";
import { linkPreviewQuery } from "@/lib/queries";
import { TextArea } from "./Field";

interface NoteFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  /** The most characters the note may hold (what the server keeps). */
  maxLength?: number;
  /** Shown as text only, with its links: no way to start editing (offline, for saved notes). */
  readOnly?: boolean;
  /**
   * The model the page shows a card for: a link to it reads as the model's title (or "makerworld.com/…") in the
   * note, and a note that is only that link reads as empty, since the card says it. Passing it (even null) also says
   * the page shows a card for each link in the note, so a note that is only one other link reads as empty too.
   */
  model?: ModelMark | null;
  /**
   * The page draws the model's card right under the note (idea and build pages): a line of the note that is only the
   * model's link isn't repeated in the read view, as a note that is only that link reads as empty. Typing still
   * shows the note as written.
   */
  modelCardBelow?: boolean;
  className?: string;
}

/** "makerworld.com/…": as much of a model's address as a note needs while its title is unknown. */
const siteOnly = (url: string) => `${new URL(url).hostname.replace(/^www\./i, "")}/…`;

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
  maxLength,
  readOnly,
  model,
  modelCardBelow,
  className,
}: NoteFieldProps) {
  const [editing, setEditing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const page = model?.kind === "page" ? model : null;
  // The model card's own title (the same query, so no second fetch).
  const { data: preview } = useQuery({ ...linkPreviewQuery(page?.url ?? ""), enabled: !!page });
  const isModel = (url: string) => !!page && sameModel(url, page.url);
  const modelText = (url: string) => (isModel(url) ? preview?.title || siteOnly(url) : undefined);
  // A note that is only the model's link has nothing to say beyond its card; so does one that is only a single other
  // link, on a page that draws a card for each link in the note (it passes `model`, null when the idea has none).
  const rest = findLinks(value)
    .reduce((left, link) => (isModel(link.url) ? left.replace(link.url, "") : left), value)
    .trim();
  const onlyModel = !!value.trim() && ((!!page && rest === "") || (model !== undefined && isLink(rest)));

  if (readOnly && (!value.trim() || onlyModel)) return null;
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
        maxLength={maxLength}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        // An empty note shows its field, and typing the first letter must not swap it for the read view under the finger.
        onFocus={() => setEditing(true)}
        onBlur={() => {
          setEditing(false);
          // A model page's link keeps only what names the model (?from=search and #profileId-… go) once typing is done.
          const tidy = tidyModelLinks(value);
          if (tidy !== value) onChange(tidy);
        }}
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
      {onlyModel ? (
        <p className="text-lead text-ink-faint md:text-body pointer-events-none relative">{"Add a note…"}</p>
      ) : (
        <p className="text-lead text-ink md:text-body pointer-events-none relative break-words whitespace-pre-wrap">
          {linkify(
            modelCardBelow && page ? withoutModelLines(value, page.url) : value,
            "pointer-events-auto text-ink underline decoration-ink-ghost decoration-1 underline-offset-3 hover:decoration-ink focus-ring rounded-xs",
            page ? modelText : undefined,
          )}
        </p>
      )}
    </div>
  );
}
