import { useId } from "react";
import { cn } from "@/lib/cn";
import { PaletteIcon } from "./icons";

/** Common filament colors, offered first in the color picker. Data, not design tokens. */
const FILAMENT_COLORS = [
  "#f4f1ea", // design-lint-ignore: jade white
  "#1d1d1f", // design-lint-ignore: black
  "#8e9089", // design-lint-ignore: gray
  "#c12e1f", // design-lint-ignore: red
  "#f0b323", // design-lint-ignore: sunflower yellow
  "#00ae42", // design-lint-ignore: bambu green
  "#0a2989", // design-lint-ignore: blue
  "#9d4f2d", // design-lint-ignore: terracotta
];

interface SwatchProps {
  /** #rrggbb, or nothing for "no color set". */
  color?: string;
  size?: "sm" | "md";
  label?: string;
  className?: string;
}

/** A filament's color as a small round chip. Without a color, a quiet empty ring. */
export function Swatch({ color, size = "sm", label, className }: SwatchProps) {
  return (
    <span
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
      className={cn(
        "inline-block shrink-0 rounded-full",
        size === "sm" ? "size-3.5" : "size-7",
        color ? "shadow-well ring-ink/15 ring-1 ring-inset" : "ring-ink-ghost ring-1 ring-inset",
        className,
      )}
      // A filament's color is data, not design.
      style={color ? { backgroundColor: color } : undefined} // design-lint-ignore
    />
  );
}

interface SwatchPickerProps {
  value: string | undefined;
  onChange: (color: string) => void;
  label?: string;
  className?: string;
}

/**
 * A swatch to tap: opens the device's color picker, with common filament
 * colors offered first. 44 px on phones.
 */
export function SwatchPicker({ value, onChange, label = "Filament color", className }: SwatchPickerProps) {
  const id = useId();
  return (
    <label
      className={cn(
        "pressable bg-ink/4 shadow-well hover:bg-ink/6 has-focus-visible:shadow-ring relative flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md md:size-9",
        className,
      )}
      title={label}
    >
      {value ? <Swatch color={value} size="md" /> : <PaletteIcon size={20} className="text-ink-faint" aria-hidden />}
      <input
        type="color"
        aria-label={label}
        list={`${id}-colors`}
        value={value ?? "#ffffff"} // design-lint-ignore: the picker needs a starting color
        onChange={(event) => onChange(event.target.value.toLowerCase())}
        className="absolute inset-0 cursor-pointer opacity-0"
      />
      <datalist id={`${id}-colors`}>
        {FILAMENT_COLORS.map((color) => (
          <option key={color} value={color} />
        ))}
      </datalist>
    </label>
  );
}
