import { type ReactNode, useId } from "react";
import { cn } from "@/lib/cn";

export interface ChoiceTile<T extends string> {
  value: T;
  label: string;
  /** A short figure under the label: "0.12 mm", "2 walls · 10%", "A2". */
  detail?: string;
  /** What it does, lowercase, said under the tiles for the one picked: "slower, smoother". */
  effect?: string;
  /** A small picture of it (ui/SlicingGlyphs.tsx, a SpoolDisc), drawn in the tile's ink. */
  glyph?: ReactNode;
  /** A picture of it, big (a plate picture: the model lying on its side), instead of a glyph: the tile grows to show it. */
  picture?: ReactNode;
  disabled?: boolean;
}

interface ChoiceTilesProps<T extends string> {
  /** Names the group: "Quality". Shown as an overline above the tiles. */
  label: string;
  options: readonly ChoiceTile<T>[];
  /** null: none of them (the value is set by hand under "More"). */
  value: T | null;
  onChange: (value: T) => void;
  /**
   * How the tiles sit: "grid" (equal columns, `columns` on phones and `wideColumns` from md) or "scroll" (a row that
   * scrolls sideways on phones, for a list that can be long: the Pantry's spools; it wraps from md), or "row" (the same
   * row at every width, within the column it is in: a settings panel's two columns).
   */
  layout?: "grid" | "scroll" | "row";
  columns?: 2 | 3 | 4;
  wideColumns?: 2 | 3 | 4;
  /** Closer tiles for a row of four on a phone: less padding, so "Extra draft" and "Where needed" fit two lines wide. */
  dense?: boolean;
  /** What is said under the tiles: by default the picked one's "Fine · slower, smoother". */
  caption?: ReactNode;
  disabled?: boolean;
  className?: string;
}

const COLUMNS = { 2: "grid-cols-2", 3: "grid-cols-3", 4: "grid-cols-4" } as const;
const WIDE_COLUMNS = { 2: "md:grid-cols-2", 3: "md:grid-cols-3", 4: "md:grid-cols-4" } as const;

/**
 * A few big, friendly choices, one of them picked: tiles with a small picture, a name and a figure, the picked one on
 * a semolina wash, and what it does said in a line under them ("Fine · slower, smoother"). Real radio inputs
 * underneath, so arrow keys and screen readers work as they should. Slicing settings (decision 0047) use it; a
 * choice of two to four short words that needs no picture is a SegmentedControl.
 */
export function ChoiceTiles<T extends string>({
  label,
  options,
  value,
  onChange,
  layout = "grid",
  columns = 3,
  wideColumns = columns,
  dense,
  caption,
  disabled,
  className,
}: ChoiceTilesProps<T>) {
  const name = useId();
  const picked = options.find((option) => option.value === value);
  const said =
    caption === undefined ? (
      picked?.effect ? (
        <>
          <span className="text-ink font-semibold">{picked.label}</span> · {picked.effect}
        </>
      ) : null
    ) : (
      caption
    );
  return (
    <fieldset disabled={disabled} className={cn("flex min-w-0 flex-col gap-2.5", className)}>
      <legend className="text-caption text-ink-faint mb-2.5 font-sans font-semibold tracking-wider uppercase">
        {label}
      </legend>
      <div
        className={cn(
          layout === "grid"
            ? cn("grid gap-2", COLUMNS[columns], WIDE_COLUMNS[wideColumns])
            : layout === "row"
              ? "flex snap-x gap-2 overflow-x-auto pb-1"
              : // Edge to edge on a phone's sheet, so the row scrolls under the thumb; wrapped from md.
                "-mx-5 flex snap-x scroll-px-5 gap-2 overflow-x-auto px-5 pb-1 md:mx-0 md:grid md:grid-cols-3 md:overflow-visible md:px-0 md:pb-0",
        )}
      >
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <label
              key={option.value}
              className={cn(
                "pressable has-focus-visible:shadow-ring relative flex min-w-0 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg text-center",
                dense ? "px-1 py-2" : "px-2 py-2.5",
                layout === "scroll" && "w-28 shrink-0 snap-start md:w-auto",
                layout === "row" && "w-28 shrink-0 snap-start",
                selected
                  ? "bg-semolina-soft text-semolina-ink ring-semolina ring-2 ring-inset"
                  : "bg-tile text-ink-soft shadow-soft hover:text-ink hover:shadow-raised",
                // Its radio is disabled by the option, these tiles, or a fieldset around them (offline, read only).
                "has-disabled:hover:shadow-soft has-disabled:cursor-default has-disabled:opacity-50",
              )}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={selected}
                disabled={option.disabled}
                onChange={() => onChange(option.value)}
                className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-default"
              />
              {option.picture && (
                <span className="flex aspect-square w-full items-center justify-center" aria-hidden>
                  {option.picture}
                </span>
              )}
              {option.glyph && (
                <span className={cn("flex h-7 items-center", !selected && "text-ink-faint")} aria-hidden>
                  {option.glyph}
                </span>
              )}
              <span
                className={cn("line-clamp-2 w-full font-semibold text-balance", dense ? "text-caption" : "text-small")}
              >
                {option.label}
              </span>
              {option.detail && (
                <span className={cn("text-caption tabular w-full truncate", !selected && "text-ink-faint")}>
                  {option.detail}
                </span>
              )}
            </label>
          );
        })}
      </div>
      {said && <p className="text-small text-ink-soft min-h-5">{said}</p>}
    </fieldset>
  );
}
