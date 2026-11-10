import { colorTone } from "@shared/spools";
import { cn } from "@/lib/cn";

const sizes = {
  sm: "size-6",
  md: "size-11",
  lg: "size-16",
  xl: "size-24",
  hero: "size-40",
  /** Three fifths of a square parent, which centers it: for a card with no photo. */
  fill: "size-3/5",
} as const;

interface SpoolDiscProps {
  /** #rrggbb; nothing for a spool without a color, or an empty slot when `empty`. */
  color?: string | null;
  size?: keyof typeof sizes;
  /** An empty slot: a dashed ring where a spool would sit. */
  empty?: boolean;
  label?: string;
  className?: string;
}

/**
 * A spool seen from the side: the filament's color, wound, around a hub.
 * The AMS slots, the pantry and a spool's page all draw spools this way.
 * The color is data, so it is set inline. A white spool on a light surface, or
 * a black one in dark mode, gets a stronger rim (`data-tone`, in app.css) so
 * it never vanishes.
 */
export function SpoolDisc({ color, size = "md", empty, label, className }: SpoolDiscProps) {
  const a11y = label ? { role: "img", "aria-label": label } : { "aria-hidden": true };
  if (empty) {
    return (
      <span
        {...a11y}
        className={cn(
          "border-ink-ghost relative inline-block shrink-0 rounded-full border-2 border-dashed",
          sizes[size],
          className,
        )}
      />
    );
  }
  return (
    <span
      {...a11y}
      className={cn(
        "spool-wound shadow-well relative inline-block shrink-0 rounded-full ring-1 ring-(--spool-rim) ring-inset",
        !color && "bg-ink/8",
        sizes[size],
        className,
      )}
      data-tone={color ? colorTone(color) : undefined}
      style={color ? { backgroundColor: color } : undefined} // design-lint-ignore: a filament's color is data
    >
      <span className="spool-hub bg-paper shadow-well absolute inset-[34%] rounded-full ring-1 ring-(--spool-hub-rim)" />
    </span>
  );
}
