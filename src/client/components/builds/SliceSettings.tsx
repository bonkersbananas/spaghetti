import engine from "virtual:slicer-engine";
import { plateName } from "@shared/attempts";
import { DEFAULT_SLICING } from "@shared/slicing/defaults.ts";
import { slicedName } from "@shared/slicing/files.ts";
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
import { type ReactNode, useState } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { ToggleChip } from "@/components/ui/Chip";
import { type ChoiceTile, ChoiceTiles } from "@/components/ui/ChoiceTiles";
import { Disclosure } from "@/components/ui/Disclosure";
import { ChipRow } from "@/components/ui/FilterChips";
import { DownloadIcon, ExternalIcon, RecipeIcon, SettingsIcon } from "@/components/ui/icons";
import { MetaList } from "@/components/ui/MetaList";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Sheet } from "@/components/ui/Sheet";
import { LayersGlyph, StrengthGlyph, SupportsGlyph } from "@/components/ui/SlicingGlyphs";
import { SpoolDisc } from "@/components/ui/SpoolDisc";
import { Stepper } from "@/components/ui/Stepper";
import { cn } from "@/lib/cn";

/**
 * How to slice a model (decision 0047): the four choices people make, as big tiles that say what they do (Quality,
 * Strength, Supports, Filament), and the rest under More. A tap changes the model's settings at once, and the card
 * slices it again in the background (lib/slicing/jobs.ts). On phones a tall sheet, its result at the thumb; on
 * desktop a popover hanging below the card, which shows the result. Loaded the first time it opens.
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
   * A model's settings, or the workspace's defaults (the Printer page, decision 0050): how a model prints, without
   * the filament, plate, nozzle or size, which are each model's.
   */
  scope?: "model" | "workspace";
  /** Recipes to slice with (decision 0050), those for its filament first. */
  recipes?: readonly (SlicingRecipe & { id: string; name: string })[];
}

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
}: SlicingChoicesProps) {
  const set = (change: Partial<SlicingSettings>) => onChange(slicingFor(change, settings));
  const model = scope === "model";
  const range = layerRange(settings.nozzle);
  const quality = qualityOf(settings.layerHeight);
  const strength = strengthOf(settings);
  const floating = slice?.status === "sliced" && !!slice.cautions?.includes("floating") && settings.supports === "off";
  const strong = (words: ReactNode) => <span className="text-ink font-semibold">{words}</span>;

  return (
    <div className="flex flex-col gap-7">
      {model && recipes.length > 0 && (
        <RecipeChoice settings={settings} spools={spools} recipes={recipes} onChange={onChange} />
      )}
      <ChoiceTiles<QualityId>
        label="Quality"
        columns={2}
        wideColumns={4}
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
              {strong(`${layerMillimetres(settings.layerHeight)} layers`)}
              {slice?.settings.project ? " · as the file has them" : ""}
            </>
          )
        }
      />
      <ChoiceTiles<StrengthId>
        label="Strength"
        options={STRENGTHS.map((choice) => ({
          value: choice.id,
          label: choice.label,
          detail: `${choice.walls} walls · ${choice.infill}%`,
          effect: choice.effect,
          glyph: <StrengthGlyph strength={choice.id} />,
        }))}
        value={strength?.id ?? null}
        onChange={(id) => {
          const choice = STRENGTHS.find((candidate) => candidate.id === id);
          if (choice) set({ walls: choice.walls, infill: choice.infill, pattern: choice.pattern });
        }}
        caption={
          strength ? undefined : (
            <>
              {strong(`${settings.walls} walls, ${settings.infill}% ${patternWords(settings.pattern)}`)} · set under
              More
            </>
          )
        }
      />
      <ChoiceTiles
        label="Supports"
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
      {model && <FilamentChoice settings={settings} spools={spools} onChange={(filaments) => set({ filaments })} />}
      <MoreSettings
        settings={settings}
        set={set}
        plates={plates}
        slice={slice}
        scalable={model && scalable}
        model={model}
        defaultOpen={moreOpen}
      />
    </div>
  );
}

/**
 * Slicing with a recipe (decision 0050): what worked before, in one tap, over the model's settings. The one it is
 * sliced with now is picked; its note says why it is the way it is.
 */
function RecipeChoice({
  settings,
  spools,
  recipes,
  onChange,
}: {
  settings: SlicingSettings;
  spools: readonly SpoolLike[];
  recipes: readonly (SlicingRecipe & { id: string; name: string; note?: string })[];
  onChange: (next: SlicingSettings) => void;
}) {
  const picked = recipes.find((recipe) => sameSlicing(settings, recipeSlicing(recipe, settings, spools)));
  return (
    <div className="flex flex-col gap-2.5">
      <span className="text-caption text-ink-faint font-sans font-semibold tracking-wider uppercase">
        From a recipe
      </span>
      <ChipRow label="Slice with a recipe">
        {recipes.map((recipe) => (
          <ToggleChip
            key={recipe.id}
            icon={RecipeIcon}
            tone="semolina"
            selected={recipe === picked}
            onClick={() => onChange(recipeSlicing(recipe, settings, spools))}
          >
            {recipe.name}
          </ToggleChip>
        ))}
      </ChipRow>
      <p className="text-small text-ink-soft">
        {picked ? (
          <>
            <span className="text-ink font-semibold">{picked.name}</span>
            {picked.note ? ` · ${picked.note}` : " · what worked before"}
          </>
        ) : (
          "What worked before, in one tap."
        )}
      </p>
    </div>
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
}: {
  settings: SlicingSettings;
  spools: readonly SpoolLike[];
  onChange: (filaments: SlicingFilament[]) => void;
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
        layout="scroll"
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
  // The kind of supports means nothing while they are off: none is shown picked, and picking one turns them on.
  const supportsOn = settings.supports !== "off";
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
        <SettingRow label="Kind of supports" wide>
          <ChipRow label="How supports are built" wrap>
            {SUPPORT_STYLES.map((choice) => (
              <ToggleChip
                key={choice.id}
                tone="semolina"
                selected={supportsOn && choice.id === settings.supportStyle}
                onClick={() =>
                  set({ supportStyle: choice.id as SupportStyle, ...(supportsOn ? {} : { supports: "where-needed" }) })
                }
              >
                {choice.label}
              </ToggleChip>
            ))}
          </ChipRow>
          {supportsOn ? (
            style && <Effect name={style.label} effect={style.effect} />
          ) : (
            <p className="text-small text-ink-faint">Supports are off. Pick a kind to have them where needed.</p>
          )}
        </SettingRow>
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
  file: { id: string; name: string; url: string };
  sliced?: string;
}

/**
 * On desktop, in a popover hanging below the card, whose card shows the result: the choices, as tall as the window
 * lets them be. The popover's own padding is the scroller's, so the fade at its edges reaches the corners.
 */
export function SliceSettingsPanel({ file, sliced, ...choices }: SliceSettingsProps) {
  return (
    <div className="scroll-fade -m-4 max-h-(--radix-popover-content-available-height) overflow-y-auto overscroll-contain p-5">
      <div className="flex flex-col gap-7">
        <SlicingChoices {...choices} />
        <SliceAbout file={file} slice={choices.slice ?? null} sliced={sliced} />
      </div>
    </div>
  );
}

/** On a phone: a tall sheet, the choices to scroll and the result where the thumb is. */
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
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="How to slice it"
      description={file.name}
      tall
      footer={<div className="min-w-0 flex-1">{result}</div>}
    >
      <div className="flex flex-col gap-7 pb-2">
        <SlicingChoices {...choices} />
        <SliceAbout file={file} slice={choices.slice ?? null} sliced={sliced} />
      </div>
    </Sheet>
  );
}

/**
 * The workspace's defaults, on the Printer page (decision 0050): how a model nobody set up is sliced here. The same
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
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="text-small text-ink-faint flex-1">
          The filament comes from the Pantry (the first loaded spool), the plate from the ones you own, the nozzle size
          from the main nozzle. A model keeps its own once you change them on its card.
        </p>
        {own && (
          <Button variant="quiet" size="sm" onClick={() => onChange(null)}>
            Back to Spaghetti's own
          </Button>
        )}
      </div>
    </div>
  );
}
