import { cn } from "@/lib/cn";
import { SameAgainIcon } from "./icons";
import { MetaList } from "./MetaList";

interface ChangeLineProps {
  /** What changed, in a few words each: "bed 60 → 65 °C", "added a brim", "dried the filament". */
  changes: ReadonlyArray<{ key: string; text: string }>;
  /** Read before the changes by a screen reader, since the arrows are only a picture: "Changed since attempt 2: ". */
  label: string;
  className?: string;
}

/**
 * What someone tried differently, each change on a semolina mark after the "same again" arrows: how a build's story
 * says what changed since the attempt before, and how search says what fixed a problem. Draws nothing without changes.
 */
export function ChangeLine({ changes, label, className }: ChangeLineProps) {
  if (!changes.length) return null;
  return (
    <span className={cn("text-small text-ink-soft flex items-start gap-1.5", className)}>
      <SameAgainIcon size={16} className="text-semolina-ink mt-0.5 shrink-0" aria-hidden />
      <span className="sr-only">{label}</span>
      <MetaList className="flex-1">
        {changes.map((change) => (
          <span
            key={change.key}
            className="bg-semolina-soft/70 text-ink max-w-full rounded-xs px-1 font-medium whitespace-nowrap"
          >
            {change.text}
          </span>
        ))}
      </MetaList>
    </span>
  );
}
