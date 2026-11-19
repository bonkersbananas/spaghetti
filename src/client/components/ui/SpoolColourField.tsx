import { QUICK_COLORS, spoolColors } from "@shared/spools";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { SegmentedControl } from "./SegmentedControl";
import { SpoolDisc } from "./SpoolDisc";
import { Swatch, SwatchPicker } from "./Swatch";

/** What a spool's colours are: one colour (`colorHex`), or two or three (`colors`, with no `colorHex`). */
export interface SpoolColourValue {
  colorHex: string | null;
  colors: string[] | null;
}

interface SpoolColourFieldProps {
  value: Omit<SpoolColourValue, "colors"> & { colors: readonly string[] | null };
  /** The colours that came out of the change, for the caller to name. */
  onChange: (value: SpoolColourValue) => void;
  className?: string;
}

const SLOT_NAMES = ["first", "second", "third"] as const;

const COUNTS = [
  { value: "1", label: "One" },
  { value: "2", label: "Two" },
  { value: "3", label: "Three" },
] as const;

/** The colours to start a new slot with: quick colours the spool doesn't have yet. */
function pad(colors: readonly string[], count: number): string[] {
  const out = colors.slice(0, count);
  for (const quick of QUICK_COLORS) {
    if (out.length >= count) break;
    if (!out.includes(quick.hex)) out.push(quick.hex);
  }
  return out;
}

const asValue = (colors: readonly string[]): SpoolColourValue =>
  colors.length > 1 ? { colorHex: null, colors: [...colors] } : { colorHex: colors[0] ?? null, colors: null };

/** The colours with exactly `count` of them: extra ones dropped, new ones started from the quick colours. */
export function withColourCount(value: SpoolColourFieldProps["value"], count: number): SpoolColourValue {
  const colors = spoolColors(value);
  return asValue(count <= 1 ? colors.slice(0, 1) : pad(colors, count));
}

/**
 * A spool's colour: one, or two or three for a co-extruded silk whose colour shifts with the angle. The common
 * filament colours are one tap each and fill the slot being edited, then move on to the next; "another" opens the
 * device's picker for that slot. The spool itself is drawn beside it, as it will show everywhere.
 */
export function SpoolColourField({ value, onChange, className }: SpoolColourFieldProps) {
  const colors = spoolColors(value);
  const count = Math.max(1, colors.length);
  const [active, setActive] = useState(0);
  const slot = Math.min(active, count - 1);

  const setCount = (next: number) => {
    onChange(withColourCount(value, next));
    setActive(0);
  };
  const setSlot = (hex: string, advance: boolean) => {
    const next = pad(colors, count);
    next[slot] = hex;
    onChange(asValue(next));
    if (advance && slot < count - 1) setActive(slot + 1);
  };

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <SegmentedControl
        label="How many colours: one, two or three"
        labelHidden
        options={COUNTS}
        value={String(count)}
        onChange={(next) => setCount(Number(next))}
      />
      {count > 1 && (
        <div className="flex items-center gap-3">
          <SpoolDisc color={null} colors={colors} size="md" label={`${count} colours`} />
          <div className="flex gap-2" role="radiogroup" aria-label="Colour to change">
            {colors.map((hex, index) => (
              // biome-ignore lint/a11y/useSemanticElements: a swatch, not a form radio.
              <button
                key={SLOT_NAMES[index]}
                type="button"
                role="radio"
                aria-checked={index === slot}
                aria-label={`Colour ${index + 1}`}
                onClick={() => setActive(index)}
                className={cn(
                  "pressable focus-ring touch-target relative grid size-10 place-items-center rounded-full md:size-8",
                  index === slot && "ring-ink ring-offset-paper ring-2 ring-offset-2",
                )}
              >
                <Swatch color={hex} size="md" className="size-full" />
              </button>
            ))}
          </div>
        </div>
      )}
      {count > 1 && <p className="text-small text-ink-faint">Pick the colours in order.</p>}
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Common colors">
        {QUICK_COLORS.map((color) => {
          const selected = colors[slot] === color.hex;
          return (
            // biome-ignore lint/a11y/useSemanticElements: a swatch, not a form radio.
            <button
              key={color.hex}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={color.name}
              title={color.name}
              onClick={() => setSlot(color.hex, true)}
              className={cn(
                "pressable focus-ring shadow-well size-9 rounded-full md:size-8",
                selected ? "ring-ink ring-offset-lifted ring-2 ring-offset-2" : "ring-ink/15 ring-1 ring-inset",
              )}
              style={{ backgroundColor: color.hex }} // design-lint-ignore: a filament's color is data
            />
          );
        })}
        <SwatchPicker
          value={colors[slot] && !QUICK_COLORS.some((c) => c.hex === colors[slot]) ? colors[slot] : undefined}
          onChange={(hex) => setSlot(hex, false)}
          label="Another color"
          className="size-9 rounded-full md:size-8"
        />
      </div>
    </div>
  );
}
