import type { Spool } from "@shared/api";
import { slotLabel, spoolName } from "@shared/spools";
import { Link } from "@tanstack/react-router";
import { Chip } from "@/components/ui/Chip";
import { RemainingMeter } from "@/components/ui/RemainingMeter";
import { SpoolDisc } from "@/components/ui/SpoolDisc";
import { cn } from "@/lib/cn";
import { spoolDragProps } from "./Ams";
import { ReadingLine } from "./ReadingLine";

/** Whether a material word is what the group heading already says (PLA under PLA). */
const sameAs = (material: string, heading?: string) =>
  !!heading && material.trim().toUpperCase() === heading.toUpperCase();

/**
 * A spool in the pantry: a tile with the spool itself in its color; what it is, how much is left, where it's loaded.
 * On a phone it is a tall tile, two across, with a big disc on top like a spool on a shelf; from `md` a compact row of
 * a small disc and its words, two or three across. Drag one onto an AMS slot on desktop.
 */
export function SpoolCard({
  spool,
  draggable = true,
  heading,
}: {
  spool: Spool;
  draggable?: boolean;
  /** The material group's heading: a material word that only repeats it is not written again. */
  heading?: string;
}) {
  const name = spoolName(spool);
  return (
    <li className="min-w-0 list-none">
      <Link
        to="/pantry/$spoolId"
        params={{ spoolId: spool.id }}
        {...(draggable ? spoolDragProps(spool.id, spool.slot) : {})}
        className="group pressable focus-ring bg-cream shadow-soft hover:shadow-raised duration-fast relative flex h-full flex-col gap-2 rounded-lg p-1.5 transition-shadow md:flex-row md:items-center md:gap-3.5 md:p-2.5"
      >
        {/* Every tile leads with its colour at the same size; the label photo is for the spool's page. */}
        <div className="bg-ink/3 flex h-24 shrink-0 items-center justify-center rounded-md md:size-16">
          <SpoolDisc
            color={spool.colorHex}
            colors={spool.colors}
            size="lg"
            className="duration-base size-20 transition-transform group-hover:rotate-12 md:size-11"
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 px-1 pb-1 md:p-0">
          <span className="text-body text-ink truncate font-semibold">{name.title}</span>
          {/* The product line may take a second line on a phone, where the tile is narrow. */}
          <span
            className={cn(
              "text-small text-ink-faint line-clamp-2 md:truncate",
              !name.detail && sameAs(spool.material, heading) && "sr-only",
            )}
          >
            {name.detail || spool.material}
          </span>
          {spool.labelRead?.status === "reading" ? (
            <ReadingLine className="text-caption mt-1" />
          ) : (
            <RemainingMeter remaining={spool.remaining} gramsLeft={spool.gramsLeft} showLabel className="mt-1" />
          )}
        </div>
        {spool.slot && (
          <Chip tone="semolina" className="tabular absolute top-3.5 right-3.5 md:static md:self-start">
            {spool.slot === "Ext" ? "External" : slotLabel(spool.slot)}
          </Chip>
        )}
      </Link>
    </li>
  );
}

/**
 * The compact spool for a phone with many: three across, the spool in its colour, its name (two lines at most) and
 * what is left in grams or a word. The product line is left to the spool's own page. Where it is loaded is a small
 * chip on the disc.
 */
export function SpoolChip({ spool }: { spool: Spool }) {
  const name = spoolName(spool);
  return (
    <li className="min-w-0 list-none">
      <Link
        to="/pantry/$spoolId"
        params={{ spoolId: spool.id }}
        className="pressable focus-ring bg-cream shadow-soft flex h-full flex-col items-center gap-1.5 rounded-lg px-1.5 pt-2 pb-2.5 text-center"
      >
        <div className="bg-ink/3 relative flex h-14 w-full items-center justify-center rounded-md">
          <SpoolDisc color={spool.colorHex} colors={spool.colors} size="lg" className="size-11" />
          {spool.slot && (
            <Chip tone="semolina" className="tabular absolute -top-1 -right-1">
              {spool.slot === "Ext" ? "Ext" : spool.slot}
            </Chip>
          )}
        </div>
        <span className="text-small text-ink line-clamp-2 w-full leading-tight font-semibold [overflow-wrap:anywhere]">{name.title}</span>
        {spool.labelRead?.status === "reading" ? (
          <ReadingLine className="text-caption" />
        ) : (
          <RemainingMeter
            remaining={spool.remaining}
            gramsLeft={spool.gramsLeft}
            showLabel
            stacked
            className="mt-auto"
          />
        )}
      </Link>
    </li>
  );
}
