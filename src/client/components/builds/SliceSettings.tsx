import engine from "virtual:slicer-engine";
import { plateName } from "@shared/attempts";
import { DEFAULT_SLICING } from "@shared/slicing/defaults.ts";
import { slicedName } from "@shared/slicing/files.ts";
import { STAND_IN_COLOURS } from "@shared/slicing/orca.ts";
import { engineSlices, filamentOfSpool, slicingSpools } from "@shared/slicing/pantry.ts";
import { recipeSlicing, type SlicingRecipe } from "@shared/slicing/recipe.ts";
import {
  BRIMS,
  type Brim,
  filamentWords,
  type InfillPattern,
  LIMITS,
  layerMillimetres,
  layerRange,
  type Orientation,
  PATTERNS,
  patternWords,
  QUALITIES,
  type QualityId,
  qualityOf,
  SLICING_NOZZLES,
  type SlicingDefaults,
  type SlicingFilament,
  type SlicingSettings,
  STRENGTHS,
  type StrengthId,
  SUPPORT_PLACEMENTS,
  SUPPORT_STYLES,
  type SupportStyle,
  sameSlicing,
  slicingDefaultsOf,
  slicingFor,
  strengthOf,
  supportStyleWords,
} from "@shared/slicing/settings.ts";
import type { FileSlice } from "@shared/slicing/types.ts";
import { type SpoolLike, slotPlace } from "@shared/spools";
import { Fragment, type ReactNode, useState } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { ToggleChip } from "@/components/ui/Chip";
import { type ChoiceTile, ChoiceTiles } from "@/components/ui/ChoiceTiles";
import { Disclosure } from "@/components/ui/Disclosure";
import { ChipDivider, ChipRow } from "@/components/ui/FilterChips";
import { DownloadIcon, ExternalIcon, RecipeIcon, SettingsIcon, UndoIcon } from "@/components/ui/icons";
import { MetaList } from "@/components/ui/MetaList";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Sheet } from "@/components/ui/Sheet";
import { Skeleton } from "@/components/ui/Skeleton";
import { LayersGlyph, PlatePicture, StrengthGlyph, SupportsGlyph } from "@/components/ui/SlicingGlyphs";
import { SpoolDisc } from "@/components/ui/SpoolDisc";
import { Stepper } from "@/components/ui/Stepper";
import { toast } from "@/components/ui/Toast";
import { cn } from "@/lib/cn";
import { type Lying, type LyingState, useLying } from "@/lib/slicing/orientations";
import { useIsDesktop } from "@/lib/use-media-query";

/**
 * How to slice a model (decision 0047): the four choices people make, as big tiles that say what they do (Quality,
 * Strength, Supports, Filament), and the rest under More. A tap changes the model's settings at once, and the card
 * slices it again in the background (lib/slicing/jobs.ts). On phones a tall sheet, its result at the thumb; on
 * desktop a panel beside the page, in two columns, its foot the result. Loaded the first time it opens.
 */

/** The spools offered as tiles, at most: a pantry is rarely bigger, and the rest are a pick under the Pantry. */
const MAX_SPOOLS = 12;

export interface SlicingChoicesProps {
  settings: SlicingSettings;
  onChange: (next: SlicingSettings) => void;
  /** The Pantry's spools, to slice with one. */
  spools: readonly SpoolLike[];
  /** The plates the Printer page says are owned. */
  plates: readonly string[];
  /** The slice there: whether parts float, or why it couldn't be (too big: scale to fit). */
  slice?: FileSlice | null;
  /** An STL, whose size can change (a 3MF's objects keep theirs). */
  scalable: boolean;
  /** More open from the start (the styleguide). */
  moreOpen?: boolean;
  /**
   * A model's settings, or the workspace's defaults (the Printer page, decision 0051): how a model prints, without
   * the filament, plate, nozzle, size or the way it lies, which are each model's.
   */
  scope?: "model" | "workspace";
  /** Recipes to slice with (decision 0051), those for its filament (`fits`) first. */
  recipes?: readonly OfferedRecipe[];
  /** How the model can lie (lib/slicing/orientations.ts): the "Lay it down" tiles show when it can lie more than one way. */
  lying?: LyingState;
  /**
   * Two columns, for a desktop panel that has to show everything without scrolling: the same order as a phone's
   * sheet, down the first column, then down the second.
   */
  twoColumns?: boolean;
  /** Under the last group: the engine's licence and the files (a model's settings). */
  after?: ReactNode;
}

/** A recipe as a model's settings offer it: `fits` when it is for the filament the model had (recipesFor). */
type OfferedRecipe = SlicingRecipe & { id: string; name: string; note?: string; fits?: boolean };

/** The choices themselves, for a model's settings or the workspace's defaults (and the styleguide). */
export function SlicingChoices({
  settings,
  onChange,
  spools,
  plates,
  slice,
  scalable,
  moreOpen,
  scope = "model",
  recipes = [],
  lying,
  twoColumns,
  after,
}: SlicingChoicesProps) {
  const set = (change: Partial<SlicingSettings>) => onChange(slicingFor(change, settings));
  const model = scope === "model";
  const range = layerRange(settings.nozzle);
  const quality = qualityOf(settings.layerHeight);
  const strength = strengthOf(settings);
  const floating = slice?.status === "sliced" && !!slice.cautions?.includes("floating") && settings.supports === "off";
  const strong = (words: ReactNode) => <span className="text-ink font-semibold">{words}</span>;

  const recipeGroup = model && recipes.length > 0 && (
    <RecipeChoice settings={settings} spools={spools} recipes={recipes} onChange={onChange} />
  );
  const qualityGroup = (
    <ChoiceTiles<QualityId>
      label="Quality"
      columns={4}
      dense
      options={QUALITIES.map((choice) => ({
        value: choice.id,
        label: choice.label,
        detail: layerMillimetres(choice.layerHeight),
        effect: choice.effect,
        glyph: <LayersGlyph quality={choice.id} />,
        disabled: choice.layerHeight < range.min - 1e-9 || choice.layerHeight > range.max + 1e-9,
      }))}
      value={quality?.id ?? null}
      onChange={(id) => {
        const choice = QUALITIES.find((candidate) => candidate.id === id);
        if (choice) set({ layerHeight: choice.layerHeight });
      }}
      caption={
        quality ? undefined : (
          <>
            {strong("Custom")} · {layerMillimetres(settings.layerHeight)} layers
            {slice?.settings.project ? " · as the file has them" : ""}
          </>
        )
      }
    />
  );
  const strengthGroup = (
    <ChoiceTiles<StrengthId | "custom">
      label="Strength"
      columns={strength ? 3 : 4}
      dense={!strength}
      options={[
        ...STRENGTHS.map((choice) => ({
          value: choice.id,
          label: choice.label,
          detail: `${choice.walls} walls · ${choice.infill}%`,
          effect: choice.effect,
          glyph: <StrengthGlyph strength={choice.id} />,
        })),
        // Walls and infill that no tile says (a recipe's, a project's): shown as its own, picked, with its numbers.
        ...(strength
          ? []
          : [
              {
                value: "custom" as const,
                label: "Custom",
                detail: `${settings.walls} walls · ${settings.infill}%`,
                glyph: <SettingsIcon size={24} aria-hidden />,
              },
            ]),
      ]}
      value={strength?.id ?? "custom"}
      onChange={(id) => {
        const choice = STRENGTHS.find((candidate) => candidate.id === id);
        if (choice) set({ walls: choice.walls, infill: choice.infill, pattern: choice.pattern });
      }}
      caption={
        strength ? undefined : (
          <>
            {strong("Custom")} · {settings.walls} walls, {settings.infill}% {patternWords(settings.pattern)}, set under
            More
          </>
        )
      }
    />
  );
  const supportsGroup = (
    <ChoiceTiles
      label="Supports"
      columns={4}
      dense
      options={SUPPORT_PLACEMENTS.map((choice) => ({
        value: choice.id,
        label: choice.label,
        effect: choice.effect,
        glyph: <SupportsGlyph placement={choice.id} />,
      }))}
      value={settings.supports}
      onChange={(supports) => set({ supports })}
      caption={floating ? <>Parts of it float in the air: {strong("Where needed")} holds them up.</> : undefined}
    />
  );
  const layGroup = model && lying && lying.status !== "none" && (
    // Turning the model is about what it needs held up: it sits with the supports, a little closer than the groups.
    <div className="-mt-3">
      <LayItDown state={lying} value={settings.orientation} onChange={(orientation) => set({ orientation })} />
    </div>
  );
  const filamentGroup = model && (
    <FilamentChoice
      settings={settings}
      spools={spools}
      onChange={(filaments) => set({ filaments })}
      wrapped={!!twoColumns}
    />
  );
  // The workspace's defaults carry no filament of their own: where the choice would be, it says where it comes from.
  const filamentRule = !model && (
    <div className="flex flex-col gap-2.5">
      <span className="text-caption text-ink-faint font-sans font-semibold tracking-wider uppercase">Filament</span>
      <p className="text-small text-ink-soft text-pretty">
        {strong("The Pantry's first loaded spool")} · the plate and nozzle come from this page
      </p>
    </div>
  );
  const more = (
    <MoreSettings
      settings={settings}
      set={set}
      plates={plates}
      slice={slice}
      scalable={model && scalable}
      model={model}
      defaultOpen={moreOpen}
    />
  );
  if (twoColumns) {
    // A desktop panel: the phone's order down the first column, then the second; the licence, the files and More close the first.
    return (
      <div className="flex flex-col gap-7">
        <div className="grid grid-cols-2 items-start gap-x-6">
          <div className="flex min-w-0 flex-col gap-7">
            {recipeGroup}
            {qualityGroup}
            {strengthGroup}
            {/* The licence, the files and More fill the room under the strength, so nothing scrolls. */}
            {after}
            {more}
          </div>
          <div className="flex min-w-0 flex-col gap-7">
            {supportsGroup}
            {layGroup}
            {filamentGroup}
            {filamentRule}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-7">
      {recipeGroup}
      {qualityGroup}
      {strengthGroup}
      {supportsGroup}
      {layGroup}
      {filamentGroup}
      {filamentRule}
      {more}
      {after}
    </div>
  );
}

/**
 * Slicing with a recipe (decision 0051): what worked before, in one tap, over the model's settings. Those for the
 * model's filament come first, set apart on a phone; the one it is sliced with now is picked, and its note says why
 * it is the way it is (the chip already says its name), with the filament when the recipe brought another.
 */
function RecipeChoice({
  settings,
  spools,
  recipes,
  onChange,
}: {
  settings: SlicingSettings;
  spools: readonly SpoolLike[];
  recipes: readonly OfferedRecipe[];
  onChange: (next: SlicingSettings) => void;
}) {
  const picked = recipes.find((recipe) => sameSlicing(settings, recipeSlicing(recipe, settings, spools)));
  const [first] = settings.filaments;
  const [open, setOpen] = useState(false);
  // One row until it is wanted: the choices below are what most slices change, and they come first on a phone.
  return (
    <Disclosure
      open={open}
      onOpenChange={setOpen}
      title="From a recipe"
      icon={RecipeIcon}
      summary={picked ? picked.name : "What worked before, in one tap"}
      appearance="plain"
    >
      <div className="flex flex-col gap-2.5 pt-1">
        <ChipRow label="Slice with a recipe">
          {recipes.map((recipe, index) => (
            <Fragment key={recipe.id}>
              {index > 0 && recipes[index - 1]?.fits && !recipe.fits && <ChipDivider />}
              <ToggleChip
                icon={RecipeIcon}
                tone="semolina"
                selected={recipe === picked}
                onClick={() => onChange(recipeSlicing(recipe, settings, spools))}
              >
                {recipe.name}
              </ToggleChip>
            </Fragment>
          ))}
        </ChipRow>
        {picked && (
          <p className="text-small text-ink-soft text-pretty">
            {picked.note || "What worked before."}
            {picked.fits === false && first && (
              <>
                {" "}
                In <span className="text-ink font-semibold">{filamentWords(first)}</span>.
              </>
            )}
          </p>
        )}
      </div>
    </Disclosure>
  );
}

/** Two directions are the same face when they are within this many degrees. */
const SAME_FACE_DEGREES = 2;

const sameFace = (a: Orientation | null, b: Orientation | null) =>
  a === b || (!!a && !!b && a[0] * b[0] + a[1] * b[1] + a[2] * b[2] > Math.cos((SAME_FACE_DEGREES * Math.PI) / 180));

/** "On its side", "Upside down"; with several sides, "On side 2". */
function lyingLabel(option: Lying, index: number, sides: number): string {
  if (!option.down) return "As designed";
  if (option.down[2] > 0.9) return "Upside down";
  return sides > 1 ? `On side ${index}` : "On its side";
}

/**
 * The faces the model can rest on, each a picture of it lying so (shared/mesh.ts finds them): "As designed" first.
 * Turning it is for strength (a part is strongest across its layers) or for less to support; the original file stays
 * as it is, only the slice is turned.
 */
function LayItDown({
  state,
  value,
  onChange,
}: {
  state: LyingState;
  value: Orientation | null;
  onChange: (orientation: Orientation | null) => void;
}) {
  if (state.status === "loading") {
    return (
      <div className="flex flex-col gap-2.5" aria-busy="true">
        <Skeleton className="h-3 w-24 rounded-xs" />
        <div className="grid grid-cols-3 gap-2">
          {["a", "b", "c"].map((tile) => (
            <Skeleton key={tile} className="aspect-4/5 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }
  if (state.status !== "ready") return null;
  const sides = state.options.filter((option) => option.down && option.down[2] <= 0.9).length;
  let side = 0;
  const options: ChoiceTile<string>[] = state.options.map((option, index) => {
    if (option.down && option.down[2] <= 0.9) side++;
    return {
      value: option.down ? `face-${index}` : "designed",
      label: lyingLabel(option, side, sides),
      detail: `${Math.round(option.height)} mm tall`,
      effect: !option.down
        ? "the way the file lies"
        : option.spots
          ? "touches the plate in a few spots: a brim helps"
          : `laid on a ${Math.round(option.area / 100)} cm² face`,
      picture: <PlatePicture src={option.src} />,
    };
  });
  const picked = state.options.findIndex((option) => sameFace(option.down, value));
  return (
    <ChoiceTiles
      label="Lay it down"
      columns={options.length >= 4 ? 4 : 3}
      dense
      options={options}
      value={picked < 0 ? null : (options[picked]?.value ?? null)}
      onChange={(id) => {
        const option = state.options[options.findIndex((candidate) => candidate.value === id)];
        if (option) onChange(option.down);
      }}
      caption={
        picked < 0 ? (
          <>
            <span className="text-ink font-semibold">Turned another way</span> · as the settings have it
          </>
        ) : undefined
      }
    />
  );
}

/** A spool's tile: its colour on the disc, its colour's name, and what it is and where. */
function spoolTile(spool: SpoolLike): ChoiceTile<string> {
  return {
    value: spool.id,
    label: spool.colorName || spool.material,
    detail: [spool.colorName ? spool.material : "", spool.slot ?? ""].filter(Boolean).join(" · ") || "On the shelf",
    glyph: <SpoolDisc color={spool.colorHex} size="sm" />,
  };
}

/** The filament (each one, for a model of several): a spool from the Pantry, loaded ones first. */
function FilamentChoice({
  settings,
  spools,
  onChange,
  wrapped,
}: {
  settings: SlicingSettings;
  spools: readonly SpoolLike[];
  onChange: (filaments: SlicingFilament[]) => void;
  /** In a panel's column: the spools wrap in rows of four, none clipped, instead of a row that scrolls sideways (a big pantry makes the panel scroll). */
  wrapped: boolean;
}) {
  const [index, setIndex] = useState(0);
  const slot = Math.min(index, settings.filaments.length - 1);
  const filament = settings.filaments[slot] ?? settings.filaments[0];
  const offered = slicingSpools(spools).slice(0, MAX_SPOOLS);
  const picked = filament?.spoolId ? offered.find((spool) => spool.id === filament.spoolId) : undefined;
  const own: ChoiceTile<string> | null =
    filament && !picked
      ? {
          value: "own",
          label: filament.colorName || filament.material,
          detail: filament.colorHex ? (filament.colorName ? filament.material : "From the file") : "Stand-in",
          glyph: <SpoolDisc color={filament.colorHex} size="sm" />,
        }
      : null;
  const caption = !filament ? null : picked ? (
    <>
      <span className="text-ink font-semibold">{filamentWords(filament)}</span> ·{" "}
      {picked.slot ? `loaded ${slotPlace(picked.slot)}` : "on the shelf"}
    </>
  ) : filament.colorHex ? (
    <>
      <span className="text-ink font-semibold">{filamentWords(filament)}</span> · as the file has it
    </>
  ) : spools.length ? (
    <>
      <span className="text-ink font-semibold">{filament.material}</span> · the stand-in, until you pick a spool
    </>
  ) : (
    <>
      <span className="text-ink font-semibold">{filament.material}</span> · the stand-in: spools in the Pantry show here
    </>
  );
  const choose = (id: string) => {
    const spool = offered.find((candidate) => candidate.id === id);
    if (!spool) return;
    onChange(settings.filaments.map((current, at) => (at === slot ? filamentOfSpool(spool) : current)));
  };
  return (
    <div className="flex flex-col gap-3">
      {settings.filaments.length > 1 && (
        <SegmentedControl
          label="Which filament"
          labelHidden
          options={settings.filaments.slice(0, 8).map((_, at) => ({ value: String(at), label: `Filament ${at + 1}` }))}
          value={String(slot)}
          onChange={(value) => setIndex(Number(value))}
        />
      )}
      <ChoiceTiles
        label={settings.filaments.length > 1 ? `Filament ${slot + 1}` : "Filament"}
        {...(wrapped ? { layout: "grid" as const, columns: 4 as const, dense: true } : { layout: "scroll" as const })}
        options={own ? [own, ...offered.map(spoolTile)] : offered.map(spoolTile)}
        value={picked ? picked.id : "own"}
        onChange={choose}
        caption={caption}
      />
    </div>
  );
}

/** One setting under More: its name, and its control beside it (under it on a phone, for a wide one). */
function SettingRow({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={cn("flex gap-2", wide ? "flex-col" : "items-center justify-between gap-4")}>
      <span className="text-small text-ink-soft font-medium">{label}</span>
      {children}
    </div>
  );
}

/** The rest, behind one tap: how supports are built, the brim, walls and infill by number, plate, nozzle, size. */
function MoreSettings({
  settings,
  set,
  plates,
  slice,
  scalable,
  model,
  defaultOpen,
}: {
  settings: SlicingSettings;
  set: (change: Partial<SlicingSettings>) => void;
  plates: readonly string[];
  slice?: FileSlice | null;
  scalable: boolean;
  /** A model's: its plate and nozzle too (a workspace's are on the Printer page). */
  model: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  const style = SUPPORT_STYLES.find((choice) => choice.id === settings.supportStyle);
  const brim = BRIMS.find((choice) => choice.id === settings.brim);
  const patterns = PATTERNS.some((choice) => choice.id === settings.pattern)
    ? PATTERNS
    : [...PATTERNS, { id: settings.pattern, label: patternWords(settings.pattern), effect: "as the file has it" }];
  const offeredPlates = [...new Set([...plates, settings.plate])];
  const fit =
    slice?.status === "failed" && slice.fitScale && ["too-big", "too-tall", "too-many"].includes(slice.problem ?? "")
      ? slice.fitScale
      : null;
  // The kind of supports means nothing while they are off.
  const supportsOn = settings.supports === "where-needed" || settings.supports === "everywhere";
  // Room in each stepper for the widest value of the column (the size's, where there is one), so they line up.
  const room = scalable ? `${LIMITS.scale.max}%` : `${LIMITS.infill.max}%`;
  const summary = [
    supportsOn ? `${supportStyleWords(settings.supportStyle)} supports` : "",
    settings.brim === "auto" ? "brim where needed" : settings.brim === "on" ? "brim" : "no brim",
    `${settings.walls} walls`,
    `${settings.infill}% ${patternWords(settings.pattern)}`,
    model ? plateName(settings.plate) : "",
    model ? `${settings.nozzle} mm nozzle` : "",
    model && settings.scale !== 100 ? `${settings.scale}%` : "",
  ].filter(Boolean);
  return (
    <Disclosure
      open={open}
      onOpenChange={setOpen}
      title="More"
      icon={SettingsIcon}
      summary={<MetaList>{summary}</MetaList>}
      appearance="plain"
    >
      <div className="flex flex-col gap-5 pt-1">
        {/* How supports are built means nothing while they are off (or the model carries fins): the Supports tiles above turn them on. */}
        {supportsOn && (
          <SettingRow label="Kind of supports" wide>
            <ChipRow label="How supports are built" wrap>
              {SUPPORT_STYLES.map((choice) => (
                <ToggleChip
                  key={choice.id}
                  tone="semolina"
                  selected={choice.id === settings.supportStyle}
                  onClick={() => set({ supportStyle: choice.id as SupportStyle })}
                >
                  {choice.label}
                </ToggleChip>
              ))}
            </ChipRow>
            {style && <Effect name={style.label} effect={style.effect} />}
          </SettingRow>
        )}
        <SettingRow label="Brim" wide>
          <SegmentedControl<Brim>
            label="Brim"
            labelHidden
            options={BRIMS.map((choice) => ({ value: choice.id, label: choice.label }))}
            value={settings.brim}
            onChange={(value) => set({ brim: value })}
          />
          {brim && <Effect name={brim.label} effect={brim.effect} />}
        </SettingRow>
        <SettingRow label="Walls">
          <Stepper
            label="Walls"
            value={settings.walls}
            min={LIMITS.walls.min}
            max={LIMITS.walls.max}
            room={room}
            onChange={(walls) => set({ walls })}
          />
        </SettingRow>
        <SettingRow label="Infill">
          <Stepper
            label="Infill"
            value={settings.infill}
            min={LIMITS.infill.min}
            max={LIMITS.infill.max}
            step={5}
            format={(value) => `${value}%`}
            room={room}
            onChange={(infill) => set({ infill })}
          />
        </SettingRow>
        <SettingRow label="Infill pattern" wide>
          <ChipRow label="Infill pattern" wrap>
            {patterns.map((choice) => (
              <ToggleChip
                key={choice.id}
                tone="semolina"
                selected={choice.id === settings.pattern}
                onClick={() => set({ pattern: choice.id as InfillPattern })}
              >
                {choice.label}
              </ToggleChip>
            ))}
          </ChipRow>
          <Effect
            name={patterns.find((choice) => choice.id === settings.pattern)?.label ?? settings.pattern}
            effect={patterns.find((choice) => choice.id === settings.pattern)?.effect ?? ""}
          />
        </SettingRow>
        {model && (
          <>
            <SettingRow label="Plate" wide>
              <ChipRow label="Plate" wrap>
                {offeredPlates.map((plate) => (
                  <ToggleChip
                    key={plate}
                    tone="semolina"
                    selected={plate === settings.plate}
                    onClick={() => set({ plate })}
                  >
                    {plateName(plate)}
                  </ToggleChip>
                ))}
              </ChipRow>
              <p className="text-caption text-ink-faint">The plates the Printer page says you have.</p>
            </SettingRow>
            <SettingRow label="Nozzle" wide>
              <SegmentedControl
                label="Nozzle"
                labelHidden
                options={SLICING_NOZZLES.map((nozzle) => ({ value: String(nozzle), label: `${nozzle} mm` }))}
                value={String(settings.nozzle)}
                onChange={(value) => set({ nozzle: Number(value) })}
              />
              {!engineSlices(settings.nozzle) && (
                <p className="text-caption text-ink-faint">Spaghetti slices for the 0.4 mm nozzle only, for now.</p>
              )}
            </SettingRow>
          </>
        )}
        {scalable && (
          <SettingRow label="Size">
            <span className="flex items-center gap-2">
              {fit && fit !== settings.scale && (
                <ToggleChip tone="semolina" onClick={() => set({ scale: fit })}>
                  Fit the plate · {fit}%
                </ToggleChip>
              )}
              <Stepper
                label="Size"
                value={settings.scale}
                min={10}
                max={LIMITS.scale.max}
                step={10}
                format={(value) => `${value}%`}
                room={room}
                onChange={(scale) => set({ scale })}
              />
            </span>
          </SettingRow>
        )}
      </div>
    </Disclosure>
  );
}

/** "Tree · branches that snap off cleanly": what the picked one does, under its chips. */
function Effect({ name, effect }: { name: string; effect: string }) {
  if (!effect) return null;
  return (
    <p className="text-small text-ink-soft">
      <span className="text-ink font-semibold">{name}</span> · {effect}
    </p>
  );
}

/** The engine, its licence and source (as the AGPL asks), and the files to download. */
export function SliceAbout({
  file,
  slice,
  sliced,
}: {
  file: { id: string; name: string; url: string };
  slice: FileSlice | null;
  /** The sliced file's address, once there is one. */
  sliced?: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-caption text-ink-faint">
        Sliced in this browser by OrcaSlicer{slice ? ` ${slice.settings.orca}` : ""}, free software under the AGPL.{" "}
        {engine.source && (
          <a
            href={engine.source}
            target="_blank"
            rel="noreferrer"
            className="focus-ring text-ink-soft hover:text-ink rounded-sm underline underline-offset-2"
          >
            Its source
            <ExternalIcon size={12} className="ml-0.5 inline align-baseline" aria-hidden />
          </a>
        )}
      </p>
      <div className="flex flex-wrap gap-2">
        {sliced && (
          <ButtonLink href={sliced} download={slicedName(file.name)} size="sm" icon={DownloadIcon}>
            The sliced file
          </ButtonLink>
        )}
        <ButtonLink href={file.url} download={file.name} size="sm" icon={DownloadIcon}>
          The original
        </ButtonLink>
      </div>
    </div>
  );
}

export interface SliceSettingsProps extends SlicingChoicesProps {
  file: { id: string; name: string; url: string; size: number };
  sliced?: string;
}

/**
 * The settings of a model as a desktop panel's body: two columns, so everything shows at once at 1440×900 with no
 * scrolling (the phone's sheet scrolls one column, in the same order).
 */
export function SliceSettingsPanel({ file, sliced, ...choices }: SliceSettingsProps) {
  const found = useLying(file, choices.settings.filaments[0]?.colorHex ?? STAND_IN_COLOURS[0], !choices.lying);
  return (
    <SlicingChoices
      {...choices}
      lying={choices.lying ?? found}
      twoColumns
      after={<SliceAbout file={file} slice={choices.slice ?? null} sliced={sliced} />}
    />
  );
}

/**
 * A phone's tall sheet, the choices to scroll and the result where the thumb is; on desktop the same in a panel
 * beside the page (no scrim: the page stays in view and live), in two columns that need no scrolling, its foot the
 * same result.
 */
export default function SliceSettingsSheet({
  open,
  onOpenChange,
  file,
  result,
  sliced,
  ...choices
}: SliceSettingsProps & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Where the slice stands, with what helps: the plate, its figures, progress, before → after and its undo. */
  result: ReactNode;
}) {
  const isDesktop = useIsDesktop();
  const found = useLying(file, choices.settings.filaments[0]?.colorHex ?? STAND_IN_COLOURS[0], open && !choices.lying);
  const about = <SliceAbout file={file} slice={choices.slice ?? null} sliced={sliced} />;
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="How to slice it"
      description={file.name}
      tall
      desktop="panel"
      wide
      modeless
      footer={<div className="min-w-0 flex-1">{result}</div>}
    >
      <div className="flex flex-col gap-7 pb-2">
        <SlicingChoices {...choices} lying={choices.lying ?? found} twoColumns={isDesktop} after={about} />
      </div>
    </Sheet>
  );
}

/**
 * The workspace's defaults, on the Printer page (decision 0051): how a model nobody set up is sliced here. The same
 * choices as a model's, without the filament (the Pantry's first loaded spool) and what is each model's own.
 */
export function WorkspaceSlicing({
  value,
  onChange,
}: {
  /** The workspace's own, or none: Spaghetti's. */
  value: SlicingDefaults | undefined;
  /** Null goes back to Spaghetti's own. */
  onChange: (next: SlicingDefaults | null) => void;
}) {
  const settings = slicingFor(value ?? {}, DEFAULT_SLICING);
  const own = !!value && !sameSlicing(settings, DEFAULT_SLICING);
  // Going back throws away what was set here: the toast takes it back (never lose work).
  const reset = () => {
    const before = value;
    onChange(null);
    if (before) toast.undo("Back to Spaghetti's own slicing", { onUndo: () => onChange(before) });
  };
  return (
    <div className="flex flex-col gap-7">
      <SlicingChoices
        settings={settings}
        onChange={(next) => onChange(slicingDefaultsOf(next))}
        spools={[]}
        plates={[]}
        scalable={false}
        scope="workspace"
      />
      {own && (
        <div className="-mt-3">
          <Button variant="quiet" size="sm" icon={UndoIcon} onClick={reset} className="-ml-3">
            Back to Spaghetti's own
          </Button>
        </div>
      )}
    </div>
  );
}
