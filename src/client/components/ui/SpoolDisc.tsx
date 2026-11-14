import { colorsTone, colorTone, normalizeColors } from "@shared/spools";
import type { CSSProperties } from "react";
import { cn } from "@/lib/cn";

const sizes = {
  /** In a line of text: a colour beside the spool that prints it. */
  xs: "size-4",
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
  /**
   * The two or three colours of a co-extruded spool (dual colour, tri-colour): drawn as even slices of the wound
   * filament, split on a slant, each a hard edge like patchwork. Wins over `color`.
   */
  colors?: readonly string[] | null;
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
export function SpoolDisc({ color, colors, size = "md", empty, label, className }: SpoolDiscProps) {
  const many = normalizeColors(colors);
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
        !color && !many && "bg-ink/8",
        sizes[size],
        className,
      )}
      data-kind={many ? (many.length === 2 ? "dual" : "tri") : undefined}
      data-tone={many ? colorsTone(many) : color ? colorTone(color) : undefined}
      style={fillOf(color, many)}
    >
      <span className="spool-hub bg-paper shadow-well absolute inset-[34%] rounded-full ring-1 ring-(--spool-hub-rim)" />
    </span>
  );
}

/** The disc's fill: a flat color, or a conic split of two or three, as a variable app.css lays under the winding. */
function fillOf(color: string | null | undefined, many: string[] | null): CSSProperties | undefined {
  // A filament's colors are data, so they are set inline.
  if (many) {
    const slice = 100 / many.length;
    const stops = many.map((hex, index) => `${hex} 0 ${Math.round((index + 1) * slice * 100) / 100}%`).join(", "); // design-lint-ignore: a filament's color is data
    return { "--spool-fill": `conic-gradient(from 200deg, ${stops})` } as CSSProperties;
  }
  return color ? { backgroundColor: color } : undefined; // design-lint-ignore: a filament's color is data
}
