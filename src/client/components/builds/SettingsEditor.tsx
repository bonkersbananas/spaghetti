import type { Spool } from "@shared/api";
import {
  type AttemptFilament,
  type AttemptSettings,
  BED_TYPES,
  FILAMENT_TYPES,
  LAYER_HEIGHTS,
  NOZZLE_DIAMETERS,
  type Nozzle,
  type Outcome,
  plateName,
} from "@shared/attempts";
import { filamentFromSpool, type PrinterHint, printerHints, spoolName } from "@shared/spools";
import { filamentFromFile, sameAsFile } from "@shared/threemf/index.ts";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useId, useState } from "react";
import { Button, IconButton } from "@/components/ui/Button";
import { Caution, FromFileMark } from "@/components/ui/Caution";
import { ToggleChip } from "@/components/ui/Chip";
import { DurationField, NumberField, TextField } from "@/components/ui/Field";
import { CloseIcon, DriedIcon, PlusIcon } from "@/components/ui/icons";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { SpoolDisc } from "@/components/ui/SpoolDisc";
import { SwatchPicker } from "@/components/ui/Swatch";
import { cn } from "@/lib/cn";
import { spoolsQuery, usePrinterSetup } from "@/lib/pantry";

interface SettingsEditorProps {
  value: AttemptSettings;
  onChange: (settings: AttemptSettings) => void;
  /** Where it failed is asked only when it didn't fully work. */
  outcome: Outcome | null;
  /** What a slicer file said: values still equal to these are marked as from the file. */
  fromFile?: AttemptSettings;
  className?: string;
}

/** Drops empty values, so "nothing typed" and "never set" are the same. */
function clean(settings: AttemptSettings): AttemptSettings {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(settings)) {
    if (value === undefined || value === "" || value === null) continue;
    if (key === "filaments") {
      const filaments = (value as AttemptFilament[])
        .map((filament) => Object.fromEntries(Object.entries(filament).filter(([, v]) => v !== undefined && v !== "")))
        .filter((filament) => Object.keys(filament).length > 0);
      if (filaments.length) next.filaments = filaments;
      continue;
    }
    next[key] = value;
  }
  return next as AttemptSettings;
}

function Group({
  title,
  mark,
  children,
  className,
}: {
  title: string;
  /** A FromFileMark when the group's values came from a slicer file. */
  mark?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex flex-col gap-3", className)}>
      <h3 className="text-caption text-ink-faint inline-flex items-center gap-1.5 font-sans font-semibold tracking-wider uppercase">
        {title}
        {mark}
      </h3>
      {children}
    </section>
  );
}

/** The gentle printer checks for some fields, as quiet lines. */
function Hints({
  hints,
  fields,
  filament,
}: {
  hints: PrinterHint[];
  fields: PrinterHint["field"][];
  filament?: number;
}) {
  const shown = hints.filter(
    (hint) => fields.includes(hint.field) && (filament === undefined || hint.filament === filament),
  );
  return shown.map((hint) => <Caution key={`${hint.field}${hint.filament ?? ""}${hint.text}`}>{hint.text}</Caution>);
}

/**
 * A filament picked from the pantry: the spool itself, its slot, and a way to
 * pick another or type it in instead.
 */
function LinkedSpool({
  spool,
  filament,
  index,
  fromFile,
  onChange,
  onUnlink,
}: {
  spool: Spool;
  filament: AttemptFilament;
  index: number;
  fromFile: boolean;
  onChange: () => void;
  onUnlink: () => void;
}) {
  const name = spoolName(spool);
  return (
    <div className="bg-ink/3 flex min-w-0 flex-1 items-center gap-3 rounded-md py-2 pr-1 pl-2.5">
      <SpoolDisc color={spool.colorHex} size="md" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-small text-ink inline-flex min-w-0 items-center gap-1 font-semibold">
          <span className="truncate">{name.title}</span>
          {fromFile && <FromFileMark />}
        </span>
        <span className="text-caption text-ink-faint truncate">
          {[name.detail, filament.amsSlot ? (filament.amsSlot === "Ext" ? "external spool" : filament.amsSlot) : ""]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </span>
      <Button variant="quiet" size="sm" onClick={onChange} aria-label={`Pick another spool for filament ${index + 1}`}>
        Change
      </Button>
      <IconButton icon={CloseIcon} label={`Type filament ${index + 1} in instead`} size="sm" onClick={onUnlink} />
    </div>
  );
}

/** Spools to pick from for a filament, the loaded ones first. */
function SpoolChoices({ spools, index, onPick }: { spools: Spool[]; index: number; onPick: (spool: Spool) => void }) {
  const sorted = [...spools]
    .filter((spool) => spool.remaining !== "empty")
    .sort(
      (a, b) =>
        Number(!b.slot) - Number(!a.slot) ||
        (a.slot ?? "").localeCompare(b.slot ?? "") ||
        a.material.localeCompare(b.material),
    );
  if (!sorted.length) return null;
  return (
    // biome-ignore lint/a11y/useSemanticElements: a row of chips, not a form field set.
    <div role="group" aria-label={`Spools for filament ${index + 1}`} className="flex flex-wrap gap-1.5">
      {sorted.map((spool) => {
        const name = spoolName(spool);
        return (
          <button
            key={spool.id}
            type="button"
            onClick={() => onPick(spool)}
            className="pressable focus-ring bg-cream text-small text-ink-soft shadow-soft hover:text-ink rounded-pill inline-flex h-9 max-w-full items-center gap-2 pr-3.5 pl-1.5 font-semibold md:h-8"
          >
            <SpoolDisc color={spool.colorHex} size="sm" />
            {spool.slot && <span className="text-ink-faint tabular">{spool.slot === "Ext" ? "Ext" : spool.slot}</span>}
            <span className="truncate">
              {name.title}
              {spool.colorName ? ` ${spool.material}` : ""}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ChipRow<T extends string | number>({
  label,
  options,
  value,
  onChange,
  format = String,
}: {
  label: string;
  options: readonly T[];
  value: T | undefined;
  onChange: (value: T | undefined) => void;
  format?: (value: T) => string;
}) {
  // A value from elsewhere (a slicer file, typed before) still shows as a choice.
  const all = value !== undefined && !options.includes(value) ? [...options, value] : options;
  return (
    // biome-ignore lint/a11y/useSemanticElements: a row of chips, not a form field set.
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {all.map((option) => (
        <ToggleChip
          key={String(option)}
          selected={option === value}
          onClick={() => onChange(option === value ? undefined : option)}
        >
          {format(option)}
        </ToggleChip>
      ))}
    </div>
  );
}

const text = (value: string) => value.trimStart() || undefined;

/**
 * Everything optional about an attempt: filaments, plate, nozzle, slicing,
 * temperatures, times and weight. It starts as the attempt before's
 * ("same as last time"), so people change only what they try differently.
 */
export function SettingsEditor({ value, onChange, outcome, fromFile, className }: SettingsEditorProps) {
  const listId = useId();
  const { data: spools = [] } = useQuery(spoolsQuery);
  const setup = usePrinterSetup();
  const hints = printerHints(value, setup);
  // Filaments whose spool is being picked again.
  const [choosing, setChoosing] = useState<Set<number>>(new Set());
  const toggleChoosing = (index: number, on: boolean) =>
    setChoosing((current) => {
      const next = new Set(current);
      if (on) next.add(index);
      else next.delete(index);
      return next;
    });
  const mark = (...keys: Array<keyof AttemptSettings>) =>
    keys.some((key) => sameAsFile(key, value, fromFile)) ? <FromFileMark /> : undefined;
  const set = <K extends keyof AttemptSettings>(key: K, next: AttemptSettings[K]) =>
    onChange(clean({ ...value, [key]: next }));
  // With no filament yet, one empty row is ready to type into.
  const filaments: AttemptFilament[] = value.filaments?.length ? value.filaments : [{}];
  const setFilament = (index: number, change: Partial<AttemptFilament>) =>
    set(
      "filaments",
      filaments.map((filament, i) => (i === index ? { ...filament, ...change } : filament)),
    );
  const supports = value.supportEnabled ? (value.supportType ?? "normal") : "none";
  const didntWork = outcome === "failed" || outcome === "partial";

  return (
    <div className={cn("flex flex-col gap-7", className)}>
      <Group title="Filament">
        <datalist id={`${listId}-types`}>
          {FILAMENT_TYPES.map((type) => (
            <option key={type} value={type} />
          ))}
        </datalist>
        {filaments.map((filament, index) => {
          const spool = filament.spoolId ? spools.find((s) => s.id === filament.spoolId) : undefined;
          const isFromFile = filamentFromFile(index, value, fromFile);
          const pick = (picked: Spool) => {
            setFilament(index, filamentFromSpool(picked, { profile: filament.profile }));
            toggleChoosing(index, false);
          };
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: filaments are their position in the AMS mapping.
            <div key={index} className="flex flex-col gap-2">
              {spool && !choosing.has(index) ? (
                <div className="flex items-center gap-2">
                  <LinkedSpool
                    spool={spool}
                    filament={filament}
                    index={index}
                    fromFile={isFromFile}
                    onChange={() => toggleChoosing(index, true)}
                    onUnlink={() =>
                      set(
                        "filaments",
                        filaments.map((f, i) => (i === index ? { ...f, spoolId: undefined } : f)),
                      )
                    }
                  />
                  {filaments.length > 1 && (
                    <IconButton
                      icon={CloseIcon}
                      label={`Remove filament ${index + 1}`}
                      size="sm"
                      onClick={() =>
                        set(
                          "filaments",
                          filaments.filter((_, i) => i !== index),
                        )
                      }
                    />
                  )}
                </div>
              ) : (
                <>
                  {spools.length > 0 && (
                    <div className="flex flex-col gap-2">
                      <span className="text-small text-ink-faint inline-flex items-center gap-1 px-0.5">
                        {filaments.length > 1 ? `Filament ${index + 1} from the pantry` : "From the pantry"}
                        {isFromFile && <FromFileMark />}
                      </span>
                      <SpoolChoices spools={spools} index={index} onPick={pick} />
                    </div>
                  )}
                  <div className="flex items-start gap-2">
                    <SwatchPicker
                      value={filament.colorHex}
                      onChange={(colorHex) => setFilament(index, { colorHex, spoolId: undefined })}
                      label={`Filament ${index + 1} color`}
                    />
                    <div className="grid min-w-0 flex-1 grid-cols-2 gap-2">
                      <TextField
                        size="sm"
                        aria-label={`Filament ${index + 1} type`}
                        placeholder="Type: PLA"
                        list={`${listId}-types`}
                        maxLength={40}
                        value={filament.type ?? ""}
                        onChange={(event) => setFilament(index, { type: text(event.target.value), spoolId: undefined })}
                      />
                      <TextField
                        size="sm"
                        aria-label={`Filament ${index + 1} brand`}
                        placeholder="Brand"
                        maxLength={60}
                        value={filament.brand ?? ""}
                        onChange={(event) =>
                          setFilament(index, { brand: text(event.target.value), spoolId: undefined })
                        }
                      />
                      <TextField
                        size="sm"
                        aria-label={`Filament ${index + 1} color name`}
                        placeholder="Color name"
                        maxLength={60}
                        value={filament.colorName ?? ""}
                        onChange={(event) =>
                          setFilament(index, { colorName: text(event.target.value), spoolId: undefined })
                        }
                      />
                      <TextField
                        size="sm"
                        aria-label={`Filament ${index + 1} AMS slot`}
                        placeholder="AMS slot: A1"
                        maxLength={16}
                        value={filament.amsSlot ?? ""}
                        onChange={(event) => setFilament(index, { amsSlot: text(event.target.value.toUpperCase()) })}
                      />
                    </div>
                    {filaments.length > 1 && (
                      <IconButton
                        icon={CloseIcon}
                        label={`Remove filament ${index + 1}`}
                        size="sm"
                        className="mt-1.5"
                        onClick={() =>
                          set(
                            "filaments",
                            filaments.filter((_, i) => i !== index),
                          )
                        }
                      />
                    )}
                  </div>
                  {choosing.has(index) && (
                    <Button
                      variant="quiet"
                      size="sm"
                      onClick={() => toggleChoosing(index, false)}
                      className="-ml-2 self-start"
                    >
                      Keep {spool ? spoolName(spool).title : "it"}
                    </Button>
                  )}
                </>
              )}
              <Hints hints={hints} fields={["filament"]} filament={index} />
            </div>
          );
        })}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="quiet"
            size="sm"
            icon={PlusIcon}
            onClick={() => set("filaments", [...filaments, {}])}
            className="-ml-2"
          >
            Add filament
          </Button>
          <ToggleChip
            selected={!!value.filamentDried}
            tone="semolina"
            icon={DriedIcon}
            onClick={() => set("filamentDried", value.filamentDried ? undefined : true)}
            className="ml-auto"
          >
            Dried
          </ToggleChip>
        </div>
      </Group>

      <Group title="Plate" mark={mark("bedType")}>
        <ChipRow
          label="Plate"
          options={BED_TYPES as readonly string[]}
          value={value.bedType}
          onChange={(bedType) => set("bedType", bedType)}
          format={plateName}
        />
      </Group>

      <Group title="Nozzle" mark={mark("nozzleDiameter")}>
        <SegmentedControl<Nozzle>
          label="Nozzle"
          labelHidden
          size="sm"
          options={[
            { value: "main", label: "Main" },
            { value: "auxiliary", label: "Auxiliary" },
          ]}
          value={value.nozzle ?? null}
          onChange={(nozzle) => set("nozzle", nozzle)}
          className="w-full"
        />
        <ChipRow
          label="Nozzle size"
          options={NOZZLE_DIAMETERS as readonly number[]}
          value={value.nozzleDiameter}
          onChange={(nozzleDiameter) => set("nozzleDiameter", nozzleDiameter)}
          format={(diameter) => `${diameter} mm`}
        />
        <Hints hints={hints} fields={["nozzle", "nozzleDiameter"]} />
      </Group>

      <Group title="Slicing" mark={mark("layerHeight")}>
        <ChipRow
          label="Layer height"
          options={LAYER_HEIGHTS as readonly number[]}
          value={value.layerHeight}
          onChange={(layerHeight) => set("layerHeight", layerHeight)}
          format={(height) => `${height.toFixed(2)} mm`}
        />
        <div className="grid grid-cols-3 gap-2.5">
          <NumberField
            size="sm"
            label="Infill"
            mark={mark("infillDensity")}
            suffix="%"
            min={0}
            max={100}
            value={value.infillDensity}
            onChange={(infillDensity) => set("infillDensity", infillDensity)}
          />
          <NumberField
            size="sm"
            label="Walls"
            mark={mark("wallLoops")}
            min={0}
            max={100}
            value={value.wallLoops}
            onChange={(wallLoops) => set("wallLoops", wallLoops)}
          />
          <div className="flex flex-col gap-1.5">
            <span className="text-small text-ink-soft px-0.5 font-semibold">Brim</span>
            <ToggleChip
              selected={!!value.brim}
              tone="semolina"
              onClick={() => set("brim", value.brim ? undefined : true)}
              className="self-start"
            >
              {value.brim ? "Brim on" : "No brim"}
            </ToggleChip>
          </div>
        </div>
        <SegmentedControl
          label={<span className="inline-flex items-center gap-1">Supports{mark("supportEnabled")}</span>}
          size="sm"
          options={[
            { value: "none", label: "No supports" },
            { value: "normal", label: "Normal" },
            { value: "tree", label: "Tree" },
          ]}
          value={supports}
          onChange={(next) =>
            onChange(
              clean({
                ...value,
                supportEnabled: next === "none" ? undefined : true,
                supportType: next === "none" ? undefined : next,
              }),
            )
          }
          className="w-full"
        />
        <TextField
          size="sm"
          label="Process profile"
          mark={mark("processPreset")}
          placeholder="0.20mm Standard @BBL X2D"
          maxLength={120}
          value={value.processPreset ?? ""}
          onChange={(event) => set("processPreset", text(event.target.value))}
        />
      </Group>

      <Group title="Temperatures">
        <div className="grid grid-cols-3 gap-2.5">
          <NumberField
            size="sm"
            label="Nozzle"
            mark={mark("nozzleTemperature")}
            suffix="°C"
            min={0}
            max={350}
            value={value.nozzleTemperature}
            onChange={(next) => set("nozzleTemperature", next)}
          />
          <NumberField
            size="sm"
            label="Bed"
            mark={mark("bedTemperature")}
            suffix="°C"
            min={0}
            max={150}
            value={value.bedTemperature}
            onChange={(next) => set("bedTemperature", next)}
          />
          <NumberField
            size="sm"
            label="Chamber"
            suffix="°C"
            min={0}
            max={100}
            value={value.chamberTemperature}
            onChange={(next) => set("chamberTemperature", next)}
          />
        </div>
        <Hints hints={hints} fields={["nozzleTemperature", "bedTemperature"]} />
      </Group>

      <Group title="Time and filament used">
        <div className="grid grid-cols-2 gap-2.5">
          <DurationField
            size="sm"
            label="Estimated"
            mark={mark("estimatedMinutes")}
            placeholder="2h 10"
            value={value.estimatedMinutes}
            onChange={(next) => set("estimatedMinutes", next)}
          />
          <DurationField
            size="sm"
            label="Actual"
            placeholder="2h 25"
            value={value.actualMinutes}
            onChange={(next) => set("actualMinutes", next)}
          />
          <NumberField
            size="sm"
            label="Weight"
            mark={mark("weightGrams")}
            suffix="g"
            decimal
            min={0}
            max={100_000}
            value={value.weightGrams}
            onChange={(next) => set("weightGrams", next)}
          />
        </div>
      </Group>

      {didntWork && (
        <Group title="Where it failed">
          <div className="grid grid-cols-2 gap-2.5">
            <NumberField
              size="sm"
              label="At"
              suffix="%"
              min={0}
              max={100}
              value={value.failedAtPercent}
              onChange={(next) => set("failedAtPercent", next)}
            />
            <NumberField
              size="sm"
              label="Or at layer"
              min={0}
              max={100_000}
              value={value.failedAtLayer}
              onChange={(next) => set("failedAtLayer", next)}
            />
          </div>
        </Group>
      )}
    </div>
  );
}
