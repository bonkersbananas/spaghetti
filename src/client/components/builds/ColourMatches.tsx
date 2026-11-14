import type { ColourChoice } from "@shared/slicing/colours.ts";
import { filamentOfSpool, slicingSpools } from "@shared/slicing/pantry.ts";
import { filamentWords } from "@shared/slicing/settings.ts";
import type { SliceColour } from "@shared/slicing/types.ts";
import { type SpoolLike, slotPlace } from "@shared/spools";
import { useState } from "react";
import { ChoiceTiles } from "@/components/ui/ChoiceTiles";
import { ArrowRightIcon, UndoIcon } from "@/components/ui/icons";
import { SpoolDisc } from "@/components/ui/SpoolDisc";
import { Swatch } from "@/components/ui/Swatch";
import { cn } from "@/lib/cn";

/** The Pantry's spools offered under a colour, at most: a pantry is rarely bigger. */
const MAX_SPOOLS = 12;
const STAND_IN = "stand-in";

/**
 * A model that brings colours of its own (issue #313), in the Filament section of "Slice with…": one row for each
 * colour, the model's on the left and the filament that prints it on the right, the nearest Pantry spool until
 * someone picks another. A colour no spool is near prints in a stand-in, said as "not in the Pantry yet". A tap on a
 * row opens the spools under it; a pick is kept with the model's settings (`choices`).
 */
export function ColourMatches({
  colours,
  choices,
  spools,
  onChange,
  wrapped,
}: {
  /** What the last slice printed each colour in. */
  colours: readonly SliceColour[];
  /** What was chosen; the rest print in the nearest spool. */
  choices: readonly ColourChoice[];
  spools: readonly SpoolLike[];
  onChange: (choices: ColourChoice[]) => void;
  /** In a panel's column: the spools wrap in rows of four instead of scrolling sideways. */
  wrapped: boolean;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const offered = slicingSpools(spools).slice(0, MAX_SPOOLS);
  const choose = (colour: SliceColour, id: string) => {
    const others = choices.filter((choice) => choice.from !== colour.hex);
    if (id === STAND_IN) {
      const filament = {
        material: "PLA",
        colorHex: colour.hex,
        ...(colour.name ? { colorName: colour.name } : {}),
      };
      onChange([...others, { from: colour.hex, filament }]);
      return;
    }
    const spool = offered.find((candidate) => candidate.id === id);
    if (spool) onChange([...others, { from: colour.hex, filament: filamentOfSpool(spool) }]);
  };
  return (
    <div className="flex flex-col gap-3">
      <span className="text-caption text-ink-faint font-sans font-semibold tracking-wider uppercase">Colours</span>
      <ul className="flex flex-col gap-1.5">
        {colours.map((colour) => {
          const isOpen = open === colour.hex;
          const spool = colour.filament.spoolId ? spools.find((s) => s.id === colour.filament.spoolId) : undefined;
          return (
            <li key={colour.hex} className="bg-paper-deep rounded-lg">
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => setOpen(isOpen ? null : colour.hex)}
                className="touch-target grid w-full grid-cols-[1fr_auto_1fr] items-center gap-2.5 rounded-lg px-3 py-2.5 text-left"
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <Swatch color={colour.hex} size="md" />
                  <span className="flex min-w-0 flex-col">
                    <span className="text-small text-ink truncate font-semibold">{colour.name ?? colour.hex}</span>
                    <span className="text-caption text-ink-faint truncate">
                      {colour.merged?.length ? `with ${colour.merged.join(", ")}` : `${colour.share}% of it`}
                    </span>
                  </span>
                </span>
                <ArrowRightIcon size={16} aria-hidden className="text-ink-faint" />
                <span className="flex min-w-0 items-center gap-2.5">
                  <SpoolDisc color={colour.filament.colorHex} size="sm" empty={false} />
                  <span className="flex min-w-0 flex-col">
                    <span className="text-small text-ink truncate font-semibold">
                      {colour.filament.colorName || colour.filament.material}
                    </span>
                    <span
                      className={cn("text-caption truncate", colour.inPantry ? "text-ink-faint" : "text-semolina-ink")}
                    >
                      {!colour.inPantry
                        ? "Not in the Pantry yet"
                        : spool?.slot
                          ? `Loaded ${slotPlace(spool.slot)}`
                          : filamentWords({ ...colour.filament, colorHex: undefined })}
                    </span>
                  </span>
                </span>
              </button>
              {isOpen && (
                <div className="flex flex-col gap-2 px-3 pt-1 pb-3">
                  <ChoiceTiles
                    label={`Print ${colour.name ?? colour.hex} in`}
                    {...(wrapped
                      ? { layout: "grid" as const, columns: 4 as const, dense: true }
                      : { layout: "scroll" as const })}
                    options={[
                      ...offered.map((candidate) => ({
                        value: candidate.id,
                        label: candidate.colorName || candidate.material,
                        detail:
                          [candidate.colorName ? candidate.material : "", candidate.slot ?? ""]
                            .filter(Boolean)
                            .join(" · ") || "On the shelf",
                        glyph: <SpoolDisc color={candidate.colorHex} size="sm" />,
                      })),
                      {
                        value: STAND_IN,
                        label: "Stand-in",
                        detail: "Not in the Pantry yet",
                        glyph: <SpoolDisc color={colour.hex} size="sm" />,
                      },
                    ]}
                    value={colour.filament.spoolId ?? STAND_IN}
                    onChange={(id) => choose(colour, id)}
                    caption={
                      colour.chosen ? (
                        <button
                          type="button"
                          className="text-ink-soft inline-flex items-center gap-1 font-medium underline"
                          onClick={() => onChange(choices.filter((choice) => choice.from !== colour.hex))}
                        >
                          <UndoIcon size={14} aria-hidden /> Back to the nearest spool
                        </button>
                      ) : (
                        "The nearest in the Pantry, until you pick another."
                      )
                    }
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
