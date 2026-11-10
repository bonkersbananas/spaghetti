import { cn } from "@/lib/cn";
import { Section } from "./shared";

export function ElevationSection() {
  const levels = [
    ["well", "shadow-well", "Fields, wells"],
    ["soft", "shadow-soft", "Cards at rest"],
    ["raised", "shadow-raised", "Hover, focus"],
    ["float", "shadow-float", "Sheets, toasts"],
  ] as const;
  return (
    <Section
      id="elevation"
      title="Elevation"
      note="Soft, warm shadows separate surfaces instead of borders. Hairlines only where shadows can't work."
    >
      <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
        {levels.map(([name, className, note]) => (
          <div key={name} className={cn("bg-cream flex h-28 flex-col justify-end rounded-lg p-4", className)}>
            <p className="text-small text-ink font-semibold">{name}</p>
            <p className="text-caption text-ink-faint">{note}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}
