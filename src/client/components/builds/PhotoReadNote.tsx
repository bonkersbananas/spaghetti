import { type PhotoRead, suggestedTagWords } from "@shared/photo-read";
import { SparkleIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";

interface PhotoReadNoteProps {
  read: PhotoRead;
  /** Where it sits: under the outcome buttons in the attempt sheet, or on the build page's "how did it go?". */
  className?: string;
}

/**
 * What Claude made of the photo, said quietly like a friend glancing at the print: "Looking at the photo…" while it
 * reads (a pulse, not a spinner), then why, with the tags it would pick. It is subordinate to the photo and to the
 * person's own choice, so it is small, faint and never asks for anything.
 */
export function PhotoReadNote({ read, className }: PhotoReadNoteProps) {
  if (read.status === "reading") {
    return (
      <p className={cn("text-small text-ink-faint flex items-center gap-2 px-0.5", className)} role="status">
        <SparkleIcon size={14} weight="fill" aria-hidden className="sg-pulse shrink-0" />
        Looking at the photo…
      </p>
    );
  }
  const tags = suggestedTagWords(read);
  return (
    <p className={cn("text-small text-ink-faint flex items-start gap-2 px-0.5", className)}>
      <SparkleIcon size={14} weight="fill" aria-hidden className="mt-1 shrink-0" />
      <span className="min-w-0">
        {read.reason}
        {tags.length > 0 && <span className="block">{tags.join(" · ")}</span>}
      </span>
    </p>
  );
}
