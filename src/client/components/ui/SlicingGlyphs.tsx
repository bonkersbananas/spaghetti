import type { QualityId, StrengthId, SupportPlacement } from "@shared/slicing/settings.ts";
import { cn } from "@/lib/cn";

/**
 * Small pictures of what a slicing choice does, drawn in the ink around them (currentColor): the layers a quality
 * prints, how solid a strength fills a part, where supports go under a ledge, and which nozzle prints. 28 × 24, for
 * ChoiceTiles.
 */

const glyph = "h-6 w-7 shrink-0";

/** Lines of filament, one on another: finer qualities print more, thinner ones in the same height. */
const BEADS: Record<QualityId, number> = { fine: 7, standard: 5, draft: 4, "extra-draft": 3 };

export function LayersGlyph({ quality, className }: { quality: QualityId; className?: string }) {
  const count = BEADS[quality];
  const gap = 1;
  const height = (22 - gap * (count - 1)) / count;
  return (
    <svg viewBox="0 0 28 24" className={cn(glyph, className)} aria-hidden fill="currentColor">
      {Array.from({ length: count }, (_, index) => (
        <rect
          // biome-ignore lint/suspicious/noArrayIndexKey: the beads are their place in the stack.
          key={index}
          x={3 + (index % 2) * 0.6}
          y={1 + index * (height + gap)}
          width={22}
          height={height}
          rx={height / 2}
        />
      ))}
    </svg>
  );
}

/** A part cut through: its walls round the outside, and infill inside, sparser or denser. */
const STRENGTH: Record<StrengthId, { walls: number; lines: number; cross: boolean }> = {
  light: { walls: 1, lines: 2, cross: false },
  standard: { walls: 1, lines: 3, cross: true },
  strong: { walls: 2, lines: 5, cross: true },
};

export function StrengthGlyph({ strength, className }: { strength: StrengthId; className?: string }) {
  const { walls, lines, cross } = STRENGTH[strength];
  const inset = 3 + walls * 2;
  const size = 20 - walls * 4;
  const step = size / (lines + 1);
  return (
    <svg
      viewBox="0 0 28 24"
      className={cn(glyph, className)}
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
    >
      {Array.from({ length: walls }, (_, index) => (
        <rect
          // biome-ignore lint/suspicious/noArrayIndexKey: the walls are their place from the outside in.
          key={index}
          x={5 + index * 2}
          y={2 + index * 2}
          width={18 - index * 4}
          height={20 - index * 4}
          rx={3 - index}
          strokeWidth={1.6}
        />
      ))}
      <g strokeWidth={1.1} opacity={0.75}>
        {Array.from({ length: lines }, (_, index) => {
          const at = (index + 1) * step;
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: the lines are their place across the part.
            <g key={index}>
              <line x1={inset + 2 + at - step / 2} y1={inset} x2={inset + 2 + at - step / 2} y2={inset + size} />
              {cross && <line x1={inset + 2} y1={inset + at} x2={inset + 2 + size - 2} y2={inset + at} />}
            </g>
          );
        })}
      </g>
    </svg>
  );
}

/** A ledge over the plate: nothing under it, one column under its far end, columns all along it, or a fin: a thin wall. */
const COLUMNS: Record<SupportPlacement, number[]> = {
  off: [],
  "where-needed": [22],
  everywhere: [13, 17.5, 22],
  fins: [],
};

export function SupportsGlyph({ placement, className }: { placement: SupportPlacement; className?: string }) {
  return (
    <svg viewBox="0 0 28 24" className={cn(glyph, className)} aria-hidden fill="currentColor">
      {/* The plate. */}
      <rect x={1} y={21.5} width={26} height={1.5} rx={0.75} opacity={0.45} />
      {/* The model: a block standing on the plate, and a ledge reaching out from its top. */}
      <rect x={3} y={4} width={7} height={17} rx={1.5} />
      <rect x={3} y={4} width={22} height={4.5} rx={1.5} />
      {COLUMNS[placement].map((x) => (
        <rect key={x} x={x - 1} y={10} width={2} height={11} rx={0.6} opacity={0.6} />
      ))}
      {placement === "fins" && (
        <>
          {/* One thin wall under the ledge, a break line across it, and the tines that join it. */}
          <rect x={16.2} y={10} width={1.6} height={11} rx={0.5} opacity={0.6} />
          <rect x={14} y={8.5} width={6} height={1.4} rx={0.5} />
          <rect x={14.8} y={16.5} width={4.4} height={0.8} fill="var(--color-tile, white)" />
        </>
      )}
    </svg>
  );
}

/**
 * A model drawn on the plate (the picture the app draws for a slice, shared/slicing/render.ts), for a ChoiceTile's
 * `picture`: contained in a square, with the drawing's clear background showing the tile. Without a picture (the
 * browser couldn't draw one) a soft stand-in keeps the tile's shape.
 */
export function PlatePicture({ src, className }: { src: string | null; className?: string }) {
  if (!src) return <span className={cn("bg-wash size-3/4 rounded-md", className)} aria-hidden />;
  return <img src={src} alt="" draggable={false} className={cn("size-full object-contain", className)} />;
}

/**
 * The X2D's two nozzles side by side, the one a slice is for drawn solid with the line it lays under it, as wide as
 * the nozzle (a 0.2 mm lays a fine one, a 0.8 mm a fat one), the other faint. `side` null: a nozzle that isn't
 * fitted, on its own.
 */
export function NozzleGlyph({
  diameter,
  side,
  className,
}: {
  diameter: number;
  side: "left" | "right" | null;
  className?: string;
}) {
  const tip = 0.5 + diameter * 2.5;
  const nozzle = (x: number, on: boolean) => (
    <g key={x} opacity={on ? 1 : 0.28}>
      <rect x={x - 3.5} y={1} width={7} height={9} rx={1.5} />
      <path d={`M${x - 3} 10.5 L${x + 3} 10.5 L${x + tip} 15.5 L${x - tip} 15.5 Z`} />
      {on && <rect x={x - 6} y={19} width={12} height={1 + diameter * 4} rx={(1 + diameter * 4) / 2} opacity={0.7} />}
    </g>
  );
  return (
    <svg viewBox="0 0 28 24" className={cn(glyph, className)} aria-hidden fill="currentColor">
      {side === null ? nozzle(14, true) : [nozzle(8, side === "left"), nozzle(20, side === "right")]}
    </svg>
  );
}
