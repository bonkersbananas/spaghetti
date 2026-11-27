import type { NameSource } from "@shared/item-name";
import { cn } from "@/lib/cn";
import { LinkIcon, NoteIcon } from "./icons";

/**
 * Under an untitled thing's empty title field, where its placeholder is a name borrowed from its link or its note
 * (shared/item-name.ts): one quiet line that says where the name came from, so the faint name reads as "not named yet,
 * type to name it" rather than as a disabled title. The shape of `ClaudeLine` ("Named by Claude"), with the source's
 * glyph in place of the sparkle. Nothing for "Untitled idea", which borrows nothing.
 */
export function NameSourceLine({ from, className }: { from: NameSource; className?: string }) {
  if (from !== "link" && from !== "note") return null;
  const Icon = from === "link" ? LinkIcon : NoteIcon;
  return (
    <p className={cn("text-small text-ink-faint flex items-center gap-1.5", className)}>
      <Icon size={14} aria-hidden className="shrink-0" />
      {from === "link" ? "Named from the link" : "Named from its first line"}
    </p>
  );
}
