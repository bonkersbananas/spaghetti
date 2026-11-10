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

/**
 * A spool in the pantry grid: its label photo, or the spool itself in its
 * color; what it is; how much is left; where it's loaded. Drag it onto an
 * AMS slot on desktop.
 */
export function SpoolCard({ spool, draggable = true }: { spool: Spool; draggable?: boolean }) {
  const name = spoolName(spool);
  return (
    <li className="min-w-0 list-none">
      <Link
        to="/pantry/$spoolId"
        params={{ spoolId: spool.id }}
        aria-label={[name.title, name.detail].filter(Boolean).join(", ")}
        {...(draggable ? spoolDragProps(spool.id, spool.slot) : {})}
        className="group pressable focus-ring bg-cream shadow-soft hover:shadow-raised duration-fast flex h-full flex-col overflow-hidden rounded-lg transition-shadow"
      >
        <div className="relative aspect-square">
          {spool.photo ? (
            <>
              <Photo
                src={photoSrc(spool.photo.id, "thumb")}
                alt=""
                color={spool.photo.color || undefined}
                className="size-full"
              />
              <SpoolDisc color={spool.colorHex} size="sm" className="ring-cream absolute bottom-2.5 left-2.5 ring-2" />
            </>
          ) : (
            <div className="bg-ink/3 flex size-full items-center justify-center">
              <SpoolDisc
                color={spool.colorHex}
                size="xl"
                className="duration-base transition-transform group-hover:rotate-12"
              />
            </div>
          )}
          {spool.slot && (
            <Chip tone="semolina" className="shadow-soft tabular absolute top-2.5 right-2.5">
              {spool.slot === "Ext" ? "External" : slotLabel(spool.slot)}
            </Chip>
          )}
        </div>
        <div className="flex flex-1 flex-col gap-0.5 p-3 pt-2.5">
          <span className="text-body text-ink truncate font-semibold">{name.title}</span>
          <span className={cn("text-small text-ink-faint truncate", !name.detail && "sr-only")}>
            {name.detail || spool.material}
          </span>
          <RemainingMeter remaining={spool.remaining} showLabel className="mt-1.5" />
        </div>
      </Link>
    </li>
  );
}
