import type { Spool } from "@shared/api";
import { slotLabel, spoolName } from "@shared/spools";
import { Link } from "@tanstack/react-router";
import { Chip } from "@/components/ui/Chip";
import { Photo } from "@/components/ui/Photo";
import { RemainingMeter } from "@/components/ui/RemainingMeter";
import { SpoolDisc } from "@/components/ui/SpoolDisc";
import { cn } from "@/lib/cn";
import { photoSrc } from "@/lib/previews";
import { spoolDragProps } from "./Ams";
import { ReadingLine } from "./ReadingLine";

/**
 * A spool in the pantry: a small tile with its label photo, or the spool
 * itself in its color; what it is, how much is left, where it's loaded. Tiles
 * sit two or three across on desktop and one per line on a phone, so a
 * shelf of spools stays short and the colors stay small. Drag one onto an AMS
 * slot on desktop.
 */
export function SpoolCard({ spool, draggable = true }: { spool: Spool; draggable?: boolean }) {
  const name = spoolName(spool);
  return (
    <li className="min-w-0 list-none">
      <Link
        to="/pantry/$spoolId"
        params={{ spoolId: spool.id }}
        {...(draggable ? spoolDragProps(spool.id, spool.slot) : {})}
        className="group pressable focus-ring bg-cream shadow-soft hover:shadow-raised duration-fast flex h-full items-center gap-3.5 rounded-lg p-2.5 transition-shadow"
      >
        <div className="bg-ink/3 relative flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-md">
          {spool.photo ? (
            <Photo
              src={photoSrc(spool.photo.id, "thumb")}
              alt=""
              color={spool.photo.color || undefined}
              className="size-full"
            />
          ) : (
            <SpoolDisc
              color={spool.colorHex}
              size="md"
              className="duration-base transition-transform group-hover:rotate-12"
            />
          )}
          {spool.photo && (
            <SpoolDisc
              color={spool.colorHex}
              size="sm"
              className="ring-cream absolute right-1 bottom-1 size-5 ring-2"
            />
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-body text-ink truncate font-semibold">{name.title}</span>
          <span className={cn("text-small text-ink-faint truncate", !name.detail && "sr-only")}>
            {name.detail || spool.material}
          </span>
          {spool.labelRead?.status === "reading" ? (
            <ReadingLine className="text-caption mt-1" />
          ) : (
            <RemainingMeter remaining={spool.remaining} gramsLeft={spool.gramsLeft} showLabel className="mt-1" />
          )}
        </div>
        {spool.slot && (
          <Chip tone="semolina" className="tabular self-start">
            {spool.slot === "Ext" ? "External" : slotLabel(spool.slot)}
          </Chip>
        )}
      </Link>
    </li>
  );
}
