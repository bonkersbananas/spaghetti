import { useState } from "react";
import { cn } from "@/lib/cn";
import { useIsDesktop } from "@/lib/use-media-query";
import { type ChoiceTile, ChoiceTiles } from "./ChoiceTiles";
import { NextIcon } from "./icons";
import { Sheet } from "./Sheet";
import { PlatePicture } from "./SlicingGlyphs";

export interface PlateOption {
  /** The project's number for it (1 is the first): "Plate 2". */
  index: number;
  /** What the project calls it, when it does (most don't). */
  name?: string;
  /** mm: how tall its tallest object stands. */
  height: number;
  /** The app's own picture of it, or the project's own until ours is drawn. */
  src: string | null;
  /** Once sliced: "1 h 20 min · 34 g", said under the height. */
  detail?: string;
}

interface PlatePickerProps {
  plates: readonly PlateOption[];
  /** The `index` of the plate chosen. */
  value: number;
  onChange: (index: number) => void;
  disabled?: boolean;
  /**
   * In a sheet's header (the slicing settings): only the plates' pictures, small, in a row that scrolls sideways, the
   * one chosen ringed. No sheet opens over a sheet, and the line below it would cost the room the first choices need.
   */
  inSheet?: boolean;
  className?: string;
}

export const plateLabel = (plate: Pick<PlateOption, "index" | "name">) => plate.name || `Plate ${plate.index}`;

/** "96 mm tall", "58 mm tall": whole millimetres, as "Lay it down" says a height. */
export const plateHeight = (mm: number) => `${Math.round(mm)} mm tall`;

/** What a plate is, in a line: "Plate 2 of 3 · 96 mm tall". */
export function plateWords(plates: readonly PlateOption[], value: number): string {
  const at = Math.max(
    0,
    plates.findIndex((plate) => plate.index === value),
  );
  const chosen = plates[at];
  if (!chosen) return "";
  return `${plateLabel(chosen)} of ${plates.length} · ${plateHeight(chosen.height)}`;
}

const tiles = (plates: readonly PlateOption[]): ChoiceTile<string>[] =>
  plates.map((plate) => ({
    value: String(plate.index),
    label: plateLabel(plate),
    detail: [plateHeight(plate.height), plate.detail].filter(Boolean).join(" · "),
    picture: <PlatePicture src={plate.src} />,
  }));

/**
 * Which plate of a project to work on, when it has several: the plates as pictures of what sits on each (our own
 * studio look, all at one scale so a tall bin reads taller than a short one), built on `ChoiceTiles` as "Lay it down"
 * is. Within a sheet (`inSheet`) just the pictures in its header. Elsewhere on desktop the tiles with their words, and
 * on a phone one line showing the plate chosen that opens a bottom sheet of large tiles, within thumb's reach. The
 * arrow keys step through them, as in any radio group (no shortcut of its own: `←` `→` are the photos' and the
 * week's, and `[` takes two keys on a Swedish keyboard). A model with a single plate has no picker.
 */
export function PlatePicker({ plates, value, onChange, disabled, inSheet, className }: PlatePickerProps) {
  const isDesktop = useIsDesktop();
  const [open, setOpen] = useState(false);
  const position = Math.max(
    0,
    plates.findIndex((plate) => plate.index === value),
  );
  const chosen = plates[position];
  if (plates.length < 2 || !chosen) return null;
  const options = tiles(plates);
  const picked = String(value);
  const choose = (id: string) => onChange(Number(id));

  if (inSheet) {
    return (
      <ChoiceTiles
        label="Plates"
        layout="strip"
        options={options}
        value={picked}
        onChange={choose}
        disabled={disabled}
        className={cn("max-w-40 md:max-w-72", className)}
      />
    );
  }
  if (isDesktop) {
    return (
      <div className={cn("flex flex-col gap-2", className)}>
        <ChoiceTiles
          label="Plates"
          columns={Math.min(4, plates.length) as 2 | 3 | 4}
          options={options}
          value={picked}
          onChange={choose}
          disabled={disabled}
        />
      </div>
    );
  }
  return (
    <div className={className}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="bg-tile shadow-soft pressable flex min-h-14 w-full items-center gap-3 rounded-lg p-2 text-left disabled:opacity-50"
      >
        <span className="size-14 shrink-0">
          <PlatePicture src={chosen.src} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-caption text-ink-faint font-sans font-semibold tracking-wider uppercase">
            {plateWords(plates, value).split(" · ")[0]}
          </span>
          <span className="text-body truncate font-semibold">{plateLabel(chosen)}</span>
          <span className="text-caption text-ink-soft tabular-nums">
            {[plateHeight(chosen.height), chosen.detail].filter(Boolean).join(" · ")}
          </span>
        </span>
        <NextIcon aria-hidden className="text-ink-faint mr-1 size-5 shrink-0" />
      </button>
      <Sheet open={open} onOpenChange={setOpen} title="Choose a plate" description="Each is printed on its own.">
        <ChoiceTiles
          label="Plates"
          columns={2}
          options={options}
          value={picked}
          onChange={(id) => {
            choose(id);
            setOpen(false);
          }}
        />
      </Sheet>
    </div>
  );
}
