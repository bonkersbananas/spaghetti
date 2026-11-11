import { type PhotoRead, suggestedTagWords } from "@shared/photo-read";
import { Chip } from "@/components/ui/Chip";
import { ClaudeLine } from "@/components/ui/ClaudeLine";
import { SparkleIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";

interface PhotoReadNoteProps {
  read: PhotoRead;
  /** Where it sits: under the outcome buttons in the attempt sheet, or on the build page's "how did it go?". */
  className?: string;
  /** The tags that would come along, as chips under the reason. Today leaves them out: the sheet shows them. */
  withTags?: boolean;
}

/**
 * What Claude made of the photo, said quietly like a friend glancing at the print: "Looking at the photo…" while it
 * reads (a pulse, not a spinner), then why, with the tags it would pick. It is subordinate to the photo and to the
 * person's own choice, so it is small, faint and never asks for anything.
 */
export function PhotoReadNote({ read, className, withTags = true }: PhotoReadNoteProps) {
  if (read.status === "reading") {
    return (
      <ClaudeLine working className={cn("px-0.5", className)}>
        Looking at the photo…
      </ClaudeLine>
    );
  }
  const tags = withTags ? suggestedTagWords(read) : [];
  if (!tags.length) {
    return <ClaudeLine className={cn("items-start px-0.5", className)}>{read.reason}</ClaudeLine>;
  }
  return (
    <div className={cn("text-small text-ink-faint flex items-start gap-1.5 px-0.5", className)}>
      <SparkleIcon size={14} weight="fill" aria-hidden className="mt-1 shrink-0" />
      <div className="flex min-w-0 flex-col gap-2">
        <p>{read.reason}</p>
        {/* The tags that come along if the suggestion is taken, outlined like the suggested button. */}
        <ul className="flex flex-wrap gap-1.5" aria-label="Suggested tags">
          {tags.map((tag) => (
            <li key={`${tag.kind}-${tag.label}`}>
              <Chip suggested tone={tag.kind === "failure" ? "tomato" : "basil"}>
                {tag.label}
              </Chip>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
