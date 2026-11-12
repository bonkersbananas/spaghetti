import type { Twist } from "@shared/api";
import type { SearchTerm } from "@shared/search";
import { Link } from "@tanstack/react-router";
import { forwardRef } from "react";
import { changesLine, sourceLine } from "@/components/twists/TwistCard";
import { Chip } from "@/components/ui/Chip";
import { Highlight } from "@/components/ui/Highlight";
import { TwistIcon } from "@/components/ui/icons";
import { NoteFace } from "@/components/ui/NoteFace";
import { Photo } from "@/components/ui/Photo";
import { cn } from "@/lib/cn";
import { photoSrc } from "@/lib/previews";

interface TwistResultProps {
  twist: Twist;
  terms: readonly SearchTerm[];
  selected: boolean;
  onHover: () => void;
  onOpen: () => void;
}

/** A twist found: the model's picture (else its words on an index card), its name, where it is from and what we changed. */
export const TwistResult = forwardRef<HTMLAnchorElement, TwistResultProps>(function TwistResult(
  { twist, terms, selected, onHover, onOpen },
  ref,
) {
  const photo = twist.source.photo;
  return (
    <Link
      ref={ref}
      to="/twists/$twistId"
      params={{ twistId: twist.id }}
      aria-current={selected || undefined}
      onPointerEnter={onHover}
      onClick={onOpen}
      className={cn(
        "pressable focus-ring flex items-start gap-3.5 rounded-lg p-2 md:gap-4",
        selected ? "bg-cream shadow-ring" : "hover:bg-ink/4",
      )}
    >
      {photo ? (
        <Photo
          src={photoSrc(photo.id, "thumb")}
          alt=""
          color={photo.color || undefined}
          className="size-20 shrink-0 rounded-md md:size-24"
        />
      ) : (
        <span className="bg-note relative size-20 shrink-0 overflow-hidden rounded-md md:size-24" aria-hidden>
          <NoteFace note={twist.note.trim() || changesLine(twist) || twist.name} compact />
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col gap-1.5 py-0.5">
        <span className="flex items-center gap-2">
          <Chip icon={TwistIcon}>Twist</Chip>
          <span className="text-small text-ink-faint ml-auto shrink-0 truncate">{sourceLine(twist)}</span>
        </span>
        <span className="text-body text-ink min-w-0 truncate font-semibold">
          <Highlight text={twist.name} terms={terms} />
        </span>
        {twist.changes.length > 0 && (
          <Highlight text={changesLine(twist)} terms={terms} className="text-small text-ink-soft line-clamp-2" />
        )}
      </span>
    </Link>
  );
});
