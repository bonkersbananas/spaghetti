import { type ColourChoice, slotKey } from "@shared/slicing/colours.ts";
import { filamentOfSpool, slicingSpools } from "@shared/slicing/pantry.ts";
import { filamentWords } from "@shared/slicing/settings.ts";
import type { SliceColour } from "@shared/slicing/types.ts";
import { nearestColorName, type SpoolLike, slotPlace } from "@shared/spools";
import { AnimatePresence, m } from "motion/react";
import { Fragment, useEffect, useRef, useState } from "react";
import { type ChoiceTile, ChoiceTiles } from "@/components/ui/ChoiceTiles";
import { Disclosure } from "@/components/ui/Disclosure";
import { ArrowRightIcon, ExpandIcon, PaletteIcon, UndoIcon } from "@/components/ui/icons";
import { MetaList } from "@/components/ui/MetaList";
import { SpoolDisc } from "@/components/ui/SpoolDisc";
import { StandInPalette } from "@/components/ui/StandInPalette";
import { Swatch } from "@/components/ui/Swatch";
import { cn } from "@/lib/cn";
import { duration, ease, scrollBehavior } from "@/lib/motion";

/** The Pantry's spools offered under a colour, at most: a pantry is rarely bigger. */
const MAX_SPOOLS = 12;
const STAND_IN = "stand-in";
const ANY = "any";

/** The short line under a spool's name: its material and where it is ("PLA · A2", "PLA · Ext"), or the shelf. */
export function spoolDetail(spool: SpoolLike): string {
  return [spool.colorName ? spool.material : "", spool.slot ?? ""].filter(Boolean).join(" · ") || "On the shelf";
}

/** A spool's tile: its colour on the disc, its colour's name, and what it is and where. */
export function spoolTile(spool: SpoolLike): ChoiceTile<string> {
  return {
    value: spool.id,
    label: spool.colorName || spool.material,
    detail: spoolDetail(spool),
    glyph: <SpoolDisc color={spool.colorHex} colors={spool.colors} size="sm" />,
  };
}

const nameOf = (colour: SliceColour) => colour.name ?? colour.hex;
/** What a choice for a colour is kept under: a model colour's #rrggbb, or a project filament's `f1`. */
const choiceKey = (colour: SliceColour) => (colour.slot ? slotKey(colour.slot) : colour.hex);
/** What a filament is, to tell two colours on one spool: its spool, else its material and colour. */
const keyOf = (colour: SliceColour) =>
  colour.filament.spoolId ?? `${colour.filament.material}${colour.filament.colorHex}`;

/**
 * A model that brings colours of its own, in the Filament section of "Slice with…": one row for each colour, the model's
 * on the left (a flat dot, its name, its share of the model) and the filament that prints it on the right (a spool
 * disc, its name and place), the nearest Pantry spool until someone picks another. A colour no spool is near prints in a
 * stand-in (a dashed ring, "Not in the Pantry yet"). A row opens in place to the spools; a pick is kept with the
 * model's settings (`choices`). A flat dot is always a model colour and a disc is always a Pantry spool.
 */
export function ColourMatches({
  colours,
  choices,
  spools,
  onChange,
  wrapped,
  wide,
}: {
  /** What the last slice printed each colour in. */
  colours: readonly SliceColour[];
  /** What was chosen; the rest print in the nearest spool. */
  choices: readonly ColourChoice[];
  spools: readonly SpoolLike[];
  onChange: (choices: ColourChoice[]) => void;
  /** In a panel's column: the spools wrap in rows of four instead of scrolling sideways. */
  wrapped: boolean;
  /** Across a panel's whole width (under its two columns): the rows sit two to a line. */
  wide?: boolean;
}) {
  const [open, setOpen] = useState<string | null>(null);
  // The rows are folded to one line until asked for: the panel and the sheet keep their room.
  const [all, setAll] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const offered = slicingSpools(spools).slice(0, MAX_SPOOLS);
  const choose = (colour: SliceColour, id: string) => {
    const others = choices.filter((choice) => choice.from !== choiceKey(colour));
    if (id === STAND_IN) {
      const filament = {
        material: colour.material ?? "PLA",
        colorHex: colour.hex,
        ...(colour.name && !colour.slot ? { colorName: colour.name } : {}),
      };
      onChange([...others, { from: choiceKey(colour), filament }]);
      return;
    }
    const spool = offered.find((candidate) => candidate.id === id);
    if (spool) onChange([...others, { from: choiceKey(colour), filament: filamentOfSpool(spool) }]);
  };
  // Any colour at all, in the row's material: a stand-in to try, kept like a spool pick.
  const chooseColour = (colour: SliceColour, hex: string, name?: string) => {
    const others = choices.filter((choice) => choice.from !== choiceKey(colour));
    const named = name ?? nearestColorName(hex);
    const filament = {
      material: colour.material ?? colour.filament.material,
      colorHex: hex,
      ...(named ? { colorName: named } : {}),
    };
    onChange([...others, { from: choiceKey(colour), filament }]);
  };
  const filaments = new Set(colours.map(keyOf));
  const shared = [...filaments].filter((key) => colours.filter((colour) => keyOf(colour) === key).length > 1).length;
  const projectRows = colours.every((colour) => !!colour.slot);
  const standIns = colours.filter((colour) => !colour.inPantry).length;
  const summary = (
    <span className="flex flex-col gap-1.5">
      <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        {colours.map((colour) => (
          <span key={choiceKey(colour)} className="flex items-center gap-1">
            <Swatch color={colour.hex} />
            <ArrowRightIcon size={10} aria-hidden className="text-ink-ghost" />
            <SpoolDisc
              color={colour.filament.colorHex}
              colors={colour.filament.colors}
              size="xs"
              empty={!colour.inPantry}
            />
          </span>
        ))}
      </span>
      <span>
        {colours.length} {projectRows ? (colours.length === 1 ? "filament" : "filaments") : "colours"} on{" "}
        {filaments.size} {filaments.size === 1 ? "spool" : "spools"}
        {shared ? ` · ${shared} shared` : ""}
        {standIns ? ` · ${standIns} not in the Pantry yet` : ""}
      </span>
    </span>
  );
  const pickerFor = (colour: SliceColour) => (
    <Picker
      colour={colour}
      spool={colour.filament.spoolId ? spools.find((s) => s.id === colour.filament.spoolId) : undefined}
      onColour={(hex, name) => chooseColour(colour, hex, name)}
      offered={offered}
      wrapped={wrapped}
      onPick={(id) => choose(colour, id)}
      onBack={() => onChange(choices.filter((choice) => choice.from !== choiceKey(colour)))}
    />
  );
  const rowTitle = (colour: SliceColour, spool: SpoolLike | undefined, sharing: SliceColour[]) => (
    <span className="grid grid-cols-1 items-center gap-2.5 md:grid-cols-[1fr_auto_1fr] md:gap-2">
      <span className="flex min-w-0 items-center gap-2.5">
        <Swatch color={colour.hex} size="md" />
        <span className="flex min-w-0 flex-col">
          {/* The colour's own name takes the width; the colours merged into it are counted under it (and named on
              hover), so a half-width row reads in two lines. */}
          <span
            className="text-small text-ink truncate font-semibold"
            title={[nameOf(colour), ...(colour.merged ?? [])].join(" & ")}
          >
            {nameOf(colour)}
          </span>
          <MetaList className="text-caption text-ink-faint font-normal">
            {colour.merged?.length ? `+${colour.merged.length} near` : ""}
            {colour.slot ? (colour.material ?? "") : `${colour.share}%`}
          </MetaList>
        </span>
      </span>
      <ArrowRightIcon size={14} aria-hidden className="text-ink-faint hidden md:block" />
      <span className="flex min-w-0 items-center gap-2.5 pl-9.5 md:pl-0">
        <SpoolDisc
          color={colour.filament.colorHex}
          colors={colour.filament.colors}
          size="sm"
          empty={!colour.inPantry}
        />
        <span className="flex min-w-0 flex-col">
          <span className="text-small text-ink font-semibold text-balance">
            {colour.filament.colorName || colour.filament.material}
          </span>
          <span className="text-caption text-ink-faint font-normal">
            {!colour.inPantry
              ? "Not in the Pantry yet"
              : spool
                ? spoolDetail(spool)
                : filamentWords({ ...colour.filament, colorHex: undefined })}
          </span>
          {sharing.length > 0 && (
            <span className="text-caption text-ink-soft font-normal">
              Same spool as {nameOf(sharing[0] as SliceColour)}
              {sharing.length > 1 ? ` and ${sharing.length - 1} more` : ""}
            </span>
          )}
        </span>
      </span>
    </span>
  );
  return (
    <div ref={box}>
      <Disclosure
        appearance="plain"
        open={all}
        onOpenChange={(next) => {
          setAll(next);
          // The rows open below the fold of a sheet: bring them into view.
          if (next) setTimeout(() => box.current?.scrollIntoView({ block: "start", behavior: scrollBehavior() }), 250);
        }}
        title="Colours"
        icon={PaletteIcon}
        summary={summary}
      >
        <p className="text-small text-ink-soft mb-2 text-pretty">
          {projectRows
            ? "Each filament of the project, and the spool that prints it."
            : "Each colour in the model, and the spool that prints it."}
        </p>
        <ul className={wide ? "grid grid-cols-2 gap-x-6 gap-y-0" : "flex flex-col"}>
          {colours.map((colour, index) => {
            const spool = colour.filament.spoolId ? spools.find((s) => s.id === colour.filament.spoolId) : undefined;
            const sharing = colours.filter((other) => other !== colour && keyOf(other) === keyOf(colour));
            const key = choiceKey(colour);
            if (!wide) {
              return (
                <li
                  key={key}
                  className="before:bg-hairline relative before:absolute before:top-0 before:right-0 before:left-0 before:h-px first:before:hidden"
                >
                  <Disclosure
                    appearance="plain"
                    open={open === key}
                    onOpenChange={(next) => setOpen(next ? key : null)}
                    title={rowTitle(colour, spool, sharing)}
                  >
                    {pickerFor(colour)}
                  </Disclosure>
                </li>
              );
            }
            // Two to a line: every header keeps its own half; the open row's picker is a cell of its own, right
            // after the line that holds the row, so nothing moves and no cell is left empty.
            const openIndex = colours.findIndex((other) => choiceKey(other) === open);
            const endsLine = index % 2 === 1 || index === colours.length - 1;
            const pickerHere = endsLine && openIndex >= 0 && openIndex >> 1 === index >> 1;
            const openColour = colours[openIndex];
            return (
              <Fragment key={key}>
                <li className="before:bg-hairline relative before:absolute before:top-0 before:right-0 before:left-0 before:h-px nth-[-n+2]:before:hidden">
                  <button
                    type="button"
                    aria-expanded={open === key}
                    onClick={() => setOpen(open === key ? null : key)}
                    className={cn(
                      "pressable focus-ring relative my-0.5 flex min-h-14 w-full items-center gap-3 rounded-md px-3 py-2 text-left",
                      open === key ? "bg-ink/6" : "hover:bg-ink/4",
                    )}
                  >
                    <span className="min-w-0 flex-1">{rowTitle(colour, spool, sharing)}</span>
                    <ExpandIcon
                      size={18}
                      weight="bold"
                      className={cn(
                        "text-ink-faint duration-base shrink-0 transition-transform ease-out",
                        open === key && "rotate-180",
                      )}
                      aria-hidden
                    />
                  </button>
                </li>
                <AnimatePresence initial={false}>
                  {pickerHere && openColour && (
                    <m.li
                      key={`${key}-picker`}
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: duration.base, ease: ease.out }}
                      className="col-span-2 overflow-hidden"
                    >
                      <div className="bg-ink/4 relative mt-1.5 mb-2 rounded-md p-3">
                        {/* A notch up to the header it belongs to: left half or right half of the panel. */}
                        <span
                          aria-hidden
                          className={cn(
                            "bg-ink/4 absolute -top-1 size-2 rotate-45",
                            openIndex % 2 === 0 ? "left-[25%]" : "left-[75%]",
                          )}
                        />
                        {pickerFor(openColour)}
                      </div>
                    </m.li>
                  )}
                </AnimatePresence>
              </Fragment>
            );
          })}
        </ul>
      </Disclosure>
    </div>
  );
}

/** The spools under an open row, the picked one scrolled into view, and what is picked said in a line. */
function Picker({
  colour,
  spool,
  offered,
  wrapped,
  onPick,
  onColour,
  onBack,
}: {
  colour: SliceColour;
  spool: SpoolLike | undefined;
  offered: readonly SpoolLike[];
  wrapped: boolean;
  onPick: (id: string) => void;
  onColour: (hex: string, name?: string) => void;
  onBack: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  // The picked tile is in view when the row opens, though the row of tiles scrolls sideways.
  useEffect(() => {
    const picked = box.current?.querySelector<HTMLElement>("input:checked")?.parentElement;
    // Only the row of tiles scrolls: scrollIntoView would also push the sheet's own clipped content sideways (WebKit at
    // 375 px cut the first letters off every line).
    const row = picked?.parentElement;
    if (!picked || !row) return;
    const at = picked.getBoundingClientRect();
    const in_ = row.getBoundingClientRect();
    const left = row.scrollLeft + (at.left - in_.left) - (row.clientWidth - at.width) / 2;
    row.scrollTo({ left: Math.max(0, left), behavior: scrollBehavior() });
  }, []);
  const filament = colour.filament;
  // A stand-in in a colour of its own, not the model's: the palette is open under the tiles.
  const custom =
    !filament.spoolId && !!filament.colorHex && filament.colorHex.toLowerCase() !== colour.hex.toLowerCase();
  const [palette, setPalette] = useState(custom);
  return (
    <div ref={box} className="flex flex-col gap-3">
      <ChoiceTiles
        label={`Print ${nameOf(colour)} in`}
        {...(wrapped ? { layout: "grid" as const, columns: 4 as const, dense: true } : { layout: "scroll" as const })}
        options={[
          ...offered.map(spoolTile),
          {
            value: STAND_IN,
            label: nameOf(colour),
            detail: "Not in the Pantry yet",
            glyph: <SpoolDisc color={colour.hex} size="md" empty />,
          },
          {
            value: ANY,
            label: custom ? (filament.colorName ?? "Your colour") : "Any colour…",
            detail: "Not in the Pantry",
            glyph: custom ? (
              <SpoolDisc color={filament.colorHex} size="md" empty />
            ) : (
              <PaletteIcon size={24} aria-hidden />
            ),
          },
        ]}
        value={palette || custom ? ANY : (filament.spoolId ?? STAND_IN)}
        onChange={(id) => {
          setPalette(id === ANY);
          if (id !== ANY) onPick(id);
        }}
        caption={
          <>
            <span className="text-ink font-semibold">{filamentWords(filament)}</span> ·{" "}
            {!colour.inPantry
              ? custom
                ? "a stand-in to try, not in the Pantry"
                : "a stand-in in the model's colour, not in the Pantry yet"
              : `${spool?.slot ? `loaded ${slotPlace(spool.slot)}` : "on the shelf"}${colour.chosen ? "" : " · the nearest in the Pantry"}`}
            {colour.chosen && (
              <button
                type="button"
                className="text-ink-soft focus-ring mt-1 flex items-center gap-1 rounded-md font-medium underline"
                onClick={onBack}
              >
                <UndoIcon size={14} aria-hidden /> Back to the nearest spool
              </button>
            )}
          </>
        }
      />
      {palette && (
        <StandInPalette
          value={custom ? filament.colorHex : undefined}
          label={`A colour for ${nameOf(colour)}`}
          onPick={onColour}
        />
      )}
    </div>
  );
}
