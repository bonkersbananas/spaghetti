import type { AttemptFilament } from "@shared/attempts";
import { Fragment } from "react";
import { Swatch } from "@/components/ui/Swatch";
import { cn } from "@/lib/cn";

interface SettingsLineProps {
  filaments: AttemptFilament[];
  /** Short pieces from summarizeSettings / summarizeResults. */
  parts: string[];
  /** How a filament is named here: "Jade white PLA". */
  name: (filament: AttemptFilament) => string;
  className?: string;
  /** Filament names stand out a little more than the rest. */
  filamentClassName?: string;
}

/**
 * An attempt's settings in one quiet line: each filament with its swatch,
 * then the rest, with a separator only between pieces.
 */
export function SettingsLine({ filaments, parts, name, className, filamentClassName }: SettingsLineProps) {
  const pieces = [
    ...filaments.map((filament, index) => (
      // biome-ignore lint/suspicious/noArrayIndexKey: filaments are their position.
      <span key={`f${index}`} className={cn("inline-flex items-center gap-1.5 font-medium", filamentClassName)}>
        <Swatch color={filament.colorHex} />
        {name(filament)}
      </span>
    )),
    ...parts.map((part) => <span key={part}>{part}</span>),
  ];
  if (!pieces.length) return null;
  return (
    <span className={cn("tabular flex flex-wrap items-center gap-x-1.5 gap-y-1", className)}>
      {pieces.map((piece, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the pieces are a fixed list for this render.
        <Fragment key={index}>
          {index > 0 && (
            <span className="text-ink-ghost" aria-hidden>
              ·
            </span>
          )}
          {piece}
        </Fragment>
      ))}
    </span>
  );
}
