import type { Spool } from "@shared/api";
import type { SearchTerm } from "@shared/search";
import { REMAINING_LABELS } from "@shared/spools";
import { Link } from "@tanstack/react-router";
import { forwardRef } from "react";
import { Highlight } from "@/components/ui/Highlight";
import { Overline } from "@/components/ui/Overline";
import { Photo } from "@/components/ui/Photo";
import { cn } from "@/lib/cn";
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
  const left =
    spool.gramsLeft !== null ? `about ${Math.round(spool.gramsLeft)} g left` : REMAINING_LABELS[spool.remaining];
  return (
    <Link
      ref={ref}
      to="/pantry/$spoolId"
      params={{ spoolId: spool.id }}
      aria-current={selected || undefined}
      onPointerEnter={onHover}
      onClick={onOpen}
      className={cn(
        "pressable focus-ring flex items-center gap-3.5 rounded-lg p-2 md:gap-4",
        selected ? "bg-cream shadow-ring" : "hover:bg-ink/4",
      )}
    >
      {spool.photo ? (
        <Photo
          src={photoSrc(spool.photo.id, "thumb")}
          alt=""
          color={spool.photo.color || undefined}
          className="size-20 shrink-0 rounded-md md:size-24"
        />
      ) : (
        <span
          aria-hidden
          className="shadow-soft size-20 shrink-0 rounded-md md:size-24"
          style={{ backgroundColor: spool.colorHex ?? "var(--color-ink-ghost)" }}
        />
      )}
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <Overline>Spool</Overline>
        <span className="text-body text-ink min-w-0 truncate font-semibold">
          <Highlight text={name} terms={terms} />
        </span>
        <span className="text-small text-ink-soft truncate">
          <Highlight text={kind} terms={terms} />
          {spool.slot ? ` · loaded in ${spool.slot}` : ""}
        </span>
        <span className="text-small text-ink-faint">{left}</span>
      </span>
    </Link>
  );
});
