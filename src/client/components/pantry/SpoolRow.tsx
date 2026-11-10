import type { Spool } from "@shared/api";
import { spoolName } from "@shared/spools";
import { daysAgo } from "@shared/time";
import { Link } from "@tanstack/react-router";
import { Chip } from "@/components/ui/Chip";
import { DriedIcon } from "@/components/ui/icons";
import { RemainingMeter } from "@/components/ui/RemainingMeter";
import { SpoolDisc } from "@/components/ui/SpoolDisc";
import { cn } from "@/lib/cn";
import { spoolDragProps } from "./Ams";

/**
 * A spool as one row of the desktop list: the disc, its name, how much is
 * left, where it is loaded and when it was dried. No header row: each column
 * says what it is with a word or an icon. Drag it onto an AMS slot like a
 * card. Rows sit in one surface and are told apart by a hairline, the one
 * place the design language draws a line.
 */
export function SpoolRow({ spool, draggable = true }: { spool: Spool; draggable?: boolean }) {
  const name = spoolName(spool);
  const empty = spool.remaining === "empty";
  return (
    <li className="after:bg-hairline relative list-none after:absolute after:inset-x-4 after:bottom-0 after:h-px last:after:hidden">
      <Link
        to="/pantry/$spoolId"
        params={{ spoolId: spool.id }}
        {...(draggable ? spoolDragProps(spool.id, spool.slot) : {})}
        className="focus-ring hover:bg-ink/4 duration-fast flex h-16 items-center gap-4 px-4 transition-colors"
      >
        {/* An empty spool steps back: its disc dims (text stays at full contrast; "Empty" says it in words). */}
        <SpoolDisc color={spool.colorHex} size="md" className={cn(empty && "opacity-60")} />
        <span className="min-w-0 flex-1">
          <span className={cn("text-body block truncate font-semibold", empty ? "text-ink-soft" : "text-ink")}>
            {name.title}
          </span>
          <span className={cn("text-small text-ink-faint block truncate", !name.detail && "sr-only")}>
            {name.detail || spool.material}
          </span>
        </span>
        <span className="w-24 shrink-0">
          <RemainingMeter remaining={spool.remaining} showLabel />
        </span>
        <span className="w-20 shrink-0">
          {spool.slot && (
            <Chip tone="semolina" className="tabular">
              {spool.slot === "Ext" ? "Ext" : spool.slot}
            </Chip>
          )}
        </span>
        <span className="text-small text-ink-faint tabular w-28 shrink-0">
          {spool.driedAt && (
            <span className="inline-flex items-center gap-1.5">
              <DriedIcon size={14} aria-hidden />
              <span className="sr-only">Dried </span>
              {daysAgo(spool.driedAt)}
            </span>
          )}
        </span>
      </Link>
    </li>
  );
}
