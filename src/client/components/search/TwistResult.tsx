import type { Twist } from "@shared/api";
import type { SearchTerm } from "@shared/search";
import { forwardRef } from "react";
import { changesLine, sourceLine } from "@/components/twists/TwistCard";
import { Chip } from "@/components/ui/Chip";
import { Highlight } from "@/components/ui/Highlight";
import { TwistIcon } from "@/components/ui/icons";
import { NoteFace } from "@/components/ui/NoteFace";
import { PhotoRow } from "@/components/ui/PhotoRow";
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
    <PhotoRow
      ref={ref}
      link={{ to: "/twists/$twistId", params: { twistId: twist.id }, onPointerEnter: onHover, onClick: onOpen }}
      photo={photo ? { src: photoSrc(photo.id, "thumb"), color: photo.color || undefined } : null}
      tile={<NoteFace note={twist.note.trim() || changesLine(twist) || twist.name} compact />}
      tileClassName="bg-note relative overflow-hidden"
      size="lg"
      align="start"
      selected={selected}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1.5 py-0.5">
        <span className="flex items-center gap-2">
          <Chip icon={TwistIcon}>Twist</Chip>
        </span>
        <span className="text-body text-ink min-w-0 truncate font-semibold">
          <Highlight text={twist.name} terms={terms} />
        </span>
        {sourceLine(twist) && <span className="text-small text-ink-faint min-w-0 truncate">{sourceLine(twist)}</span>}
        {twist.changes.length > 0 && (
          <Highlight text={changesLine(twist)} terms={terms} className="text-small text-ink-soft line-clamp-2" />
        )}
      </span>
    </PhotoRow>
  );
});
