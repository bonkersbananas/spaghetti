import { type AttemptSettings, BED_TYPES, LAYER_HEIGHTS, plateName } from "@shared/attempts";
import { filamentFromSpool, spoolName } from "@shared/spools";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ValueChip } from "@/components/ui/Chip";
import { NumberField } from "@/components/ui/Field";
import { spoolsQuery } from "@/lib/pantry-queries";
import { ChipRow, SpoolChoices } from "../SettingsEditor";

export type Key = "filament" | "bedType" | "layerHeight" | "nozzleTemperature" | "bedTemperature" | "infillDensity";

/**
 * Which chips show a changed value (semolina): one that has a value now and differs from `base`. A change this leaves
 * out (a cleared value, a dropped filament, supports, brim…) has no chip, so the summary line has to say it.
 */
export function chipMarks(settings: AttemptSettings, base?: AttemptSettings): Record<Key, boolean> {
  const first = settings.filaments?.[0];
  const before = base?.filaments?.[0];
  const sameFilament =
    before?.spoolId === first?.spoolId &&
    before?.brand === first?.brand &&
    before?.type === first?.type &&
    before?.profile === first?.profile &&
    before?.colorHex === first?.colorHex &&
    before?.colorName === first?.colorName;
  const differs = <K extends keyof AttemptSettings>(key: K) =>
    !!base && settings[key] !== undefined && base[key] !== settings[key];
  return {
    filament: !!base && !!(first?.brand || first?.type || first?.spoolId) && !sameFilament,
    bedType: differs("bedType"),
    layerHeight: differs("layerHeight"),
    nozzleTemperature: differs("nozzleTemperature"),
    bedTemperature: differs("bedTemperature"),
    infillDensity: differs("infillDensity"),
  };
}

/**
 * What carried over from the attempt before, as chips: tap the one that changes and its field opens right under the
 * row (the usual second attempt changes one thing). Everything else stays in the full settings behind the row.
 * `onMore` opens those, for a filament there is no pantry to pick from.
 */
export function ChangeChips({
  settings,
  onChange,
  onMore,
  base,
}: {
  settings: AttemptSettings;
  /** What the attempt began as: a chip whose value differs from it is marked as changed. */
  base?: AttemptSettings;
  onChange: (settings: AttemptSettings) => void;
  onMore: () => void;
}) {
  const [editing, setEditing] = useState<Key | null>(null);
  const { data: spools = [] } = useQuery(spoolsQuery);
  const first = settings.filaments?.[0];
  const filament = first && [first.brand, first.type].filter(Boolean).join(" ");
  const spool = first?.spoolId ? spools.find((s) => s.id === first.spoolId) : undefined;
  const chips: Array<{ key: Key; label: string }> = [];
  const filamentLabel = filament || (spool ? spoolName(spool).title : "");
  if (filamentLabel) chips.push({ key: "filament", label: filamentLabel });
  if (settings.bedType) chips.push({ key: "bedType", label: plateName(settings.bedType) });
  if (settings.layerHeight !== undefined)
    chips.push({ key: "layerHeight", label: `${settings.layerHeight.toFixed(2)} mm layers` });
  if (settings.nozzleTemperature !== undefined)
    chips.push({ key: "nozzleTemperature", label: `Nozzle ${settings.nozzleTemperature} °C` });
  if (settings.bedTemperature !== undefined)
    chips.push({ key: "bedTemperature", label: `Bed ${settings.bedTemperature} °C` });
  if (settings.infillDensity !== undefined)
    chips.push({ key: "infillDensity", label: `${settings.infillDensity}% infill` });
  // A field emptied to type a new number has no value to name its chip: the chip stays while its field is open.
  const NAMES: Record<Key, string> = {
    filament: "Filament",
    bedType: "Plate",
    layerHeight: "Layer height",
    nozzleTemperature: "Nozzle",
    bedTemperature: "Bed",
    infillDensity: "Infill",
  };
  if (editing && !chips.some((chip) => chip.key === editing)) chips.push({ key: editing, label: NAMES[editing] });
  // Always in the same order, so the chip under a finger stays put while its value is emptied and typed again.
  const order = Object.keys(NAMES);
  chips.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  if (!chips.length) return null;

  const changedKeys = chipMarks(settings, base);
  const set = (next: Partial<AttemptSettings>) => onChange({ ...settings, ...next });
  const number = (
    key: "nozzleTemperature" | "bedTemperature" | "infillDensity",
    label: string,
    suffix: string,
    max: number,
  ) => (
    <NumberField
      size="sm"
      label={label}
      suffix={suffix}
      min={0}
      max={max}
      autoFocus
      value={settings[key]}
      onChange={(next) => set({ [key]: next })}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          setEditing(null);
        }
      }}
      className="w-36"
    />
  );

  return (
    <div className="flex flex-col gap-3 pb-1">
      <p className="text-small text-ink-soft px-0.5 font-semibold">
        Trying something different? <span className="text-ink-faint font-medium">Tap a value.</span>
      </p>
      {/* biome-ignore lint/a11y/useSemanticElements: a row of chips, not a form field set. */}
      <div role="group" aria-label="What carried over" className="flex flex-wrap gap-1.5">
        {chips.map(({ key, label }) => (
          <ValueChip
            key={key}
            open={editing === key}
            changed={changedKeys[key]}
            aria-label={`Change ${label}`}
            onClick={() => {
              if (key === "filament" && !spools.length) onMore();
              else setEditing(editing === key ? null : key);
            }}
            className="max-w-full"
          >
            {label}
          </ValueChip>
        ))}
      </div>
      {editing === "nozzleTemperature" && number("nozzleTemperature", "Nozzle", "°C", 350)}
      {editing === "bedTemperature" && number("bedTemperature", "Bed", "°C", 150)}
      {editing === "infillDensity" && number("infillDensity", "Infill", "%", 100)}
      {editing === "layerHeight" && (
        <ChipRow
          label="Layer height"
          options={LAYER_HEIGHTS as readonly number[]}
          value={settings.layerHeight}
          onChange={(layerHeight) => set({ layerHeight })}
          format={(height) => `${height.toFixed(2)} mm`}
        />
      )}
      {editing === "bedType" && (
        <ChipRow
          label="Plate"
          options={BED_TYPES as readonly string[]}
          value={settings.bedType}
          onChange={(bedType) => set({ bedType })}
          format={plateName}
        />
      )}
      {editing === "filament" && (
        <SpoolChoices
          spools={spools}
          index={0}
          onPick={(picked) => {
            const [head, ...rest] = settings.filaments ?? [{}];
            set({ filaments: [filamentFromSpool(picked, { profile: head?.profile }), ...rest] });
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
