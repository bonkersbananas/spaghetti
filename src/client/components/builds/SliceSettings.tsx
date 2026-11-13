import engine from "virtual:slicer-engine";
import { plateName } from "@shared/attempts";
import { slicedName } from "@shared/slicing/files.ts";
import { engineSlices, filamentOfSpool, slicingSpools } from "@shared/slicing/pantry.ts";
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
  type SlicingFilament,
  type SlicingSettings,
  STRENGTHS,
  type StrengthId,
  SUPPORT_PLACEMENTS,
  SUPPORT_STYLES,
  type SupportStyle,
  slicingFor,
  strengthOf,
  supportStyleWords,
} from "@shared/slicing/settings.ts";
import type { FileSlice } from "@shared/slicing/types.ts";
import { type SpoolLike, slotPlace } from "@shared/spools";
import { type ReactNode, useState } from "react";
import { ButtonLink } from "@/components/ui/Button";
import { ToggleChip } from "@/components/ui/Chip";
import { type ChoiceTile, ChoiceTiles } from "@/components/ui/ChoiceTiles";
import { Disclosure } from "@/components/ui/Disclosure";
import { ChipRow } from "@/components/ui/FilterChips";
import { DownloadIcon, ExternalIcon, SettingsIcon } from "@/components/ui/icons";
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
 * desktop a popover beside the card, its result on top. Loaded the first time it opens.
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
}

/** The choices themselves, for a model's settings (and the styleguide). */
export function SlicingChoices({ settings, onChange, spools, plates, slice, scalable, moreOpen }: SlicingChoicesProps) {
  const set = (change: Partial<SlicingSettings>) => onChange(slicingFor(change, settings));
  const range = layerRange(settings.nozzle);
  const quality = qualityOf(settings.layerHeight);
  const strength = strengthOf(settings);
  const floating = slice?.status === "sliced" && !!slice.cautions?.includes("floating") && settings.supports === "off";
  const strong = (words: ReactNode) => <span className="text-ink font-semibold">{words}</span>;

  return (
    <div className="flex flex-col gap-7">
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
      <FilamentChoice settings={settings} spools={spools} onChange={(filaments) => set({ filaments })} />
      <MoreSettings
        settings={settings}
        set={set}
        plates={plates}
        slice={slice}
        scalable={scalable}
        defaultOpen={moreOpen}
      />
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
  defaultOpen,
}: {
  settings: SlicingSettings;
  set: (change: Partial<SlicingSettings>) => void;
  plates: readonly string[];
  slice?: FileSlice | null;
  scalable: boolean;
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
  const summary = [
    `${supportStyleWords(settings.supportStyle)} supports`,
    settings.brim === "auto" ? "brim where needed" : settings.brim === "on" ? "brim" : "no brim",
    `${settings.walls} walls`,
    `${settings.infill}% ${patternWords(settings.pattern)}`,
    plateName(settings.plate),
    `${settings.nozzle} mm nozzle`,
    settings.scale !== 100 ? `${settings.scale}%` : "",
  ].filter(Boolean);
  return (
    <Disclosure
      open={open}
      onOpenChange={setOpen}
      title="More"
      icon={SettingsIcon}
      summary={<MetaList>{summary}</MetaList>}
    >
      <div className="flex flex-col gap-5 pt-1">
        <SettingRow label="Supports are" wide>
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
            className="focus-ring text-ink-soft hover:text-ink inline-flex items-center gap-0.5 rounded-sm underline underline-offset-2"
          >
            Its source
            <ExternalIcon size={12} aria-hidden />
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
  /** Where the slice stands, with what helps: the plate, its figures, progress, before → after and its undo. */
  result: ReactNode;
  sliced?: string;
}

/** On desktop, in a popover beside the card: the result on top, then the choices, then where it comes from. */
export function SliceSettingsPanel({ file, result, sliced, ...choices }: SliceSettingsProps) {
  return (
    <div className="flex flex-col gap-6">
      {result}
      <SlicingChoices {...choices} />
      <SliceAbout file={file} slice={choices.slice ?? null} sliced={sliced} />
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
}: SliceSettingsProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
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
