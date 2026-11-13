import type { AttemptFilament } from "@shared/attempts";
import type { ReactNode } from "react";
import { MetaList } from "@/components/ui/MetaList";
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
  /** How each piece of text is drawn, such as with search matches highlighted. */
  renderText?: (text: string) => ReactNode;
}

/**
 * An attempt's settings in one quiet line: each filament with its swatch (none
 * when it has no colour: an empty ring would read as a radio button), then the
 * rest, dot-separated (a MetaList, so no dot begins or ends a line).
 */
export function SettingsLine({
  filaments,
  parts,
  name,
  className,
  filamentClassName,
  renderText = (text) => text,
}: SettingsLineProps) {
  return (
    <MetaList className={cn("tabular", className)}>
      {filaments.map((filament, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: filaments are their position.
        <span key={`f${index}`} className={cn("inline-flex items-center gap-1.5 font-medium", filamentClassName)}>
          {filament.colorHex && <Swatch color={filament.colorHex} />}
          {renderText(name(filament))}
        </span>
      ))}
      {parts.map((part) => (
        <span key={part} className="whitespace-nowrap">
          {renderText(part)}
        </span>
      ))}
    </MetaList>
  );
}
