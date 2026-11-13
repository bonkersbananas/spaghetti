import type { Spool } from "@shared/api";
import type { SearchTerm } from "@shared/search";
import { forwardRef } from "react";
import { Highlight } from "@/components/ui/Highlight";
import { PhotoRow } from "@/components/ui/PhotoRow";
import { RemainingMeter } from "@/components/ui/RemainingMeter";
import { SpoolDisc } from "@/components/ui/SpoolDisc";
import { photoSrc } from "@/lib/previews";

interface SpoolResultProps {
  spool: Spool;
  terms: readonly SearchTerm[];
  selected: boolean;
  onHover: () => void;
  onOpen: () => void;
}

/** A spool found: its label photo or a swatch of its colour, what it is, where it is loaded and how much is left. */
export const SpoolResult = forwardRef<HTMLAnchorElement, SpoolResultProps>(function SpoolResult(
  { spool, terms, selected, onHover, onOpen },
  ref,
) {
  const name = [spool.colorName, spool.brand].filter(Boolean).join(" · ") || spool.material;
  const kind = [spool.finish, spool.material].filter(Boolean).join(" ");
  return (
    <PhotoRow
      ref={ref}
      link={{ to: "/pantry/$spoolId", params: { spoolId: spool.id }, onPointerEnter: onHover, onClick: onOpen }}
      photo={spool.photo ? { src: photoSrc(spool.photo.id, "thumb"), color: spool.photo.color || undefined } : null}
      tile={<SpoolDisc color={spool.colorHex} size="lg" />}
      size="lg"
      selected={selected}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-body text-ink min-w-0 truncate font-semibold">
          <Highlight text={name} terms={terms} />
        </span>
        <span className="text-small text-ink-soft truncate">
          <Highlight text={kind} terms={terms} />
          {spool.slot ? ` · loaded in ${spool.slot}` : ""}
        </span>
        <RemainingMeter remaining={spool.remaining} gramsLeft={spool.gramsLeft} showLabel />
      </span>
    </PhotoRow>
  );
});
