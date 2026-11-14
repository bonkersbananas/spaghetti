import { type ReactNode, useId, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { shortcutCaps, useHotkeys } from "@/lib/hotkeys";
import { useIsDesktop } from "@/lib/use-media-query";
import { NextIcon } from "./icons";
import { Kbd } from "./Kbd";
import { Photo } from "./Photo";
import { Sheet } from "./Sheet";

export interface PlateOption {
  /** The project's number for it (1 is the first): "Plate 2". */
  index: number;
  /** What the project calls it, when it does (most don't). */
  name?: string;
  /** mm: how tall its tallest object stands. */
  height: number;
  /** The app's own picture of it. */
  src: string | null;
  /** The project's own picture, shown until ours is drawn (and where ours can't be). */
  placeholder?: string | null;
  /** Once sliced: "1 h 20 · 34 g", said under the height. */
  detail?: string;
}

interface PlatePickerProps {
  plates: readonly PlateOption[];
  /** The `index` of the plate chosen. */
  value: number;
  onChange: (index: number) => void;
  disabled?: boolean;
  /** Smaller tiles, picture beside the words, for where room is short (the slicing settings' panel). */
  dense?: boolean;
  className?: string;
}

export const plateLabel = (plate: Pick<PlateOption, "index" | "name">) => plate.name || `Plate ${plate.index}`;

/** "96 mm", "57.6 mm": whole millimetres, a decimal only when it has one worth saying. */
export const plateHeight = (mm: number) => `${Math.round(mm * 10) / 10} mm`;

function PlatePicture({ plate, className }: { plate: PlateOption; className?: string }) {
  const src = plate.src ?? plate.placeholder ?? null;
  return (
    <div className={className ?? "aspect-square w-full"}>
      {src ? (
        <Photo key={src} src={src} alt="" fit="contain" frame="deep" className="size-full rounded-md p-1.5" />
      ) : (
        <div className="bg-paper-deep size-full rounded-md" aria-hidden />
      )}
    </div>
  );
}

/** One plate as a radio tile: its picture, its name, its height and (sliced) its time and weight. */
function PlateTile({
  plate,
  selected,
  name,
  onPick,
  disabled,
  dense,
  className,
}: {
  plate: PlateOption;
  selected: boolean;
  name: string;
  onPick: () => void;
  disabled?: boolean;
  dense?: boolean;
  className?: string;
}) {
  return (
    <label
      className={cn(
        "pressable has-focus-visible:shadow-ring relative flex min-w-0 cursor-pointer rounded-lg p-2 text-left",
        dense ? "items-center gap-2.5" : "flex-col gap-2",
        selected
          ? "bg-semolina-soft text-semolina-ink ring-semolina ring-2 ring-inset"
          : "bg-tile text-ink-soft shadow-soft hover:text-ink hover:shadow-raised",
        "has-disabled:hover:shadow-soft has-disabled:cursor-default has-disabled:opacity-50",
        className,
      )}
    >
      <input
        type="radio"
        name={name}
        checked={selected}
        disabled={disabled}
        onChange={onPick}
        className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-default"
      />
      <PlatePicture plate={plate} className={dense ? "size-12 shrink-0" : undefined} />
      <span className={cn("flex min-w-0 flex-col", !dense && "px-0.5")}>
        <span className="text-small truncate font-semibold">{plateLabel(plate)}</span>
        <span className="text-caption text-ink-faint tabular-nums">{plateHeight(plate.height)}</span>
        {plate.detail && <span className="text-caption text-ink-soft tabular-nums">{plate.detail}</span>}
      </span>
    </label>
  );
}

/**
 * Which plate of a project to work on, when it has several: the plates as pictures of what sits on each (our own
 * studio look, not Bambu's render), with height and, once sliced, time and grams. On desktop a row of tiles that is
 * a radio group, which `[` and `]` step through; on a phone one line showing the plate chosen that opens a bottom
 * sheet of large tiles, within thumb's reach. A model with a single plate has no picker.
 */
export function PlatePicker({ plates, value, onChange, disabled, dense, className }: PlatePickerProps) {
  const isDesktop = useIsDesktop();
  const name = useId();
  const [open, setOpen] = useState(false);
  const position = Math.max(
    0,
    plates.findIndex((plate) => plate.index === value),
  );
  const chosen = plates[position];
  const row = useRef<HTMLFieldSetElement>(null);
  const step = (by: number) => {
    const next = plates[(position + by + plates.length) % plates.length];
    if (next && !disabled) onChange(next.index);
  };
  // `[` and `]` on desktop, in the panel of the slicing settings too (it is a dialog, with no scrim).
  useHotkeys(isDesktop && plates.length > 1 ? { platePrevious: () => step(-1), plateNext: () => step(1) } : {}, {
    inDialog: () => row.current,
  });

  if (plates.length < 2 || !chosen) return null;

  if (!isDesktop) {
    return (
      <div className={className}>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen(true)}
          className="bg-tile shadow-soft pressable flex min-h-14 w-full items-center gap-3 rounded-lg p-2 text-left disabled:opacity-50"
        >
          <PlatePicture plate={chosen} className="size-14 shrink-0" />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-caption text-ink-faint font-sans font-semibold tracking-wider uppercase">
              Plate {position + 1} of {plates.length}
            </span>
            <span className="text-body truncate font-semibold">{plateLabel(chosen)}</span>
            <span className="text-caption text-ink-soft tabular-nums">
              {[plateHeight(chosen.height), chosen.detail].filter(Boolean).join(" · ")}
            </span>
          </span>
          <NextIcon aria-hidden className="text-ink-faint mr-1 size-5 shrink-0" />
        </button>
        <Sheet open={open} onOpenChange={setOpen} title="Choose a plate" description="Each is printed on its own.">
          <PlateGrid
            plates={plates}
            value={value}
            name={name}
            onPick={(index) => {
              onChange(index);
              setOpen(false);
            }}
          />
        </Sheet>
      </div>
    );
  }

  return (
    <fieldset ref={row} disabled={disabled} className={cn("flex min-w-0 flex-col", className)}>
      <legend className="text-caption text-ink-faint mb-2.5 flex items-center gap-2 font-sans font-semibold tracking-wider uppercase">
        Plates
        <span className="flex items-center gap-1 tracking-normal normal-case">
          <Kbd keys={shortcutCaps("platePrevious")} />
          <Kbd keys={shortcutCaps("plateNext")} />
        </span>
      </legend>
      <PlateGrid plates={plates} value={value} name={name} onPick={onChange} dense={dense} />
    </fieldset>
  );
}

function PlateGrid({
  plates,
  value,
  name,
  onPick,
  dense,
}: {
  plates: readonly PlateOption[];
  value: number;
  name: string;
  onPick: (index: number) => void;
  dense?: boolean;
}): ReactNode {
  return (
    <div
      role="radiogroup"
      aria-label="Plates"
      className="grid grid-cols-2 gap-3 md:flex md:gap-2 md:overflow-x-auto md:pb-1"
    >
      {plates.map((plate) => (
        <PlateTile
          key={plate.index}
          plate={plate}
          name={name}
          selected={plate.index === value}
          onPick={() => onPick(plate.index)}
          dense={dense}
          className={dense ? "md:min-w-40 md:flex-1" : "md:max-w-44 md:min-w-28 md:flex-1"}
        />
      ))}
    </div>
  );
}
