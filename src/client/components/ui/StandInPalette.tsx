import { QUICK_COLORS } from "@shared/spools";
import { cn } from "@/lib/cn";
import { SwatchPicker } from "./Swatch";

/** Colours to try that a spool isn't usually bought in at first: the ones people ask "how would it look in…" about. */
const TRYOUT_COLOURS: ReadonlyArray<{ name: string; hex: string }> = [
  { name: "Neon yellow", hex: "#e4f01c" }, // design-lint-ignore: a filament colour is data
  { name: "Neon green", hex: "#39e75f" }, // design-lint-ignore: a filament colour is data
  { name: "Neon pink", hex: "#ff4fa3" }, // design-lint-ignore: a filament colour is data
  { name: "Sky blue", hex: "#5bb5e8" }, // design-lint-ignore: a filament colour is data
];
const COLOURS = [...QUICK_COLORS, ...TRYOUT_COLOURS];

/**
 * A small palette of common filament colours and one of your own, for trying a model in a colour that isn't in the
 * Pantry. A tap picks; the colour that is picked wears a ring. Nothing here is a spool: the caller prints it as a
 * stand-in.
 */
export function StandInPalette({
  value,
  onPick,
  label = "Any colour",
  className,
}: {
  /** The colour picked now (#rrggbb), if one is. */
  value?: string;
  /** The colour and its name (the common colours', else none). */
  onPick: (hex: string, name?: string) => void;
  label?: string;
  className?: string;
}) {
  const common = COLOURS.some((color) => color.hex === value);
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)} role="radiogroup" aria-label={label}>
      {COLOURS.map((color) => {
        const selected = value === color.hex;
        return (
          // biome-ignore lint/a11y/useSemanticElements: a swatch, not a form radio.
          <button
            key={color.hex}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={color.name}
            title={color.name}
            onClick={() => onPick(color.hex, color.name)}
            className={cn(
              "pressable focus-ring shadow-well ring-ink/15 size-10 rounded-full ring-1 ring-inset md:size-8",
              selected && "ring-ink ring-offset-paper ring-2 ring-offset-2",
            )}
            style={{ backgroundColor: color.hex }} // design-lint-ignore: a filament's color is data
          />
        );
      })}
      <SwatchPicker
        value={value && !common ? value : undefined}
        onChange={(hex) => onPick(hex)}
        label="Your own colour"
        className="size-10 rounded-full md:size-8"
      />
    </div>
  );
}
