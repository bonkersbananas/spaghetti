import type { Spool } from "@shared/api";
import type { ReactNode } from "react";
import { ToggleChip } from "@/components/ui/Chip";
import { TextField } from "@/components/ui/Field";

export type LabelFactValues = Pick<
  Spool,
  | "diameterMm"
  | "nozzleTempMin"
  | "nozzleTempMax"
  | "bedTempMin"
  | "bedTempMax"
  | "dryTempC"
  | "dryHours"
  | "productCode"
>;

interface LabelFactsProps {
  value: LabelFactValues;
  onChange: (changes: Partial<LabelFactValues>) => void;
  /** The "from the label" mark for these fields, or null when they are the person's own. */
  mark: (...fields: Array<keyof LabelFactValues>) => ReactNode;
}

/** A whole number from what was typed, or null when the field is empty. */
const whole = (text: string) => {
  const digits = text.replace(/\D/g, "").slice(0, 3);
  return digits ? Number(digits) : null;
};

function Temp({
  label,
  min,
  max,
}: {
  label: string;
  min: { value: number | null; onChange: (value: number | null) => void };
  max: { value: number | null; onChange: (value: number | null) => void };
}) {
  return (
    <div className="flex items-end gap-2">
      <TextField
        size="sm"
        label={label}
        aria-label={`${label}, from`}
        inputMode="numeric"
        placeholder="from"
        value={min.value ?? ""}
        onChange={(event) => min.onChange(whole(event.target.value))}
        className="w-24"
      />
      <span className="text-ink-faint pb-2" aria-hidden>
        –
      </span>
      <TextField
        size="sm"
        aria-label={`${label}, to`}
        inputMode="numeric"
        placeholder="to"
        value={max.value ?? ""}
        onChange={(event) => max.onChange(whole(event.target.value))}
        className="w-24"
      />
      <span className="text-small text-ink-faint pb-2">°C</span>
    </div>
  );
}

/**
 * What a spool's label says about printing and drying it: diameter, nozzle and bed range, drying, the product code.
 * Each is the person's to edit; the ones Claude read carry a quiet "from the label" until touched.
 */
export function LabelFacts({ value, onChange, mark }: LabelFactsProps) {
  return (
    <div className="flex flex-col gap-4 md:max-w-md">
      <div className="flex flex-col gap-2.5">
        <span className="flex items-baseline gap-2 px-0.5">
          <span className="text-small text-ink-soft font-semibold">Filament diameter</span>
          {mark("diameterMm")}
        </span>
        <div className="flex gap-2">
          {[1.75, 2.85].map((mm) => (
            <ToggleChip
              key={mm}
              selected={value.diameterMm === mm}
              onClick={() => onChange({ diameterMm: value.diameterMm === mm ? null : mm })}
            >
              {mm} mm
            </ToggleChip>
          ))}
        </div>
      </div>
      <Temp
        label="Nozzle"
        min={{ value: value.nozzleTempMin, onChange: (nozzleTempMin) => onChange({ nozzleTempMin }) }}
        max={{ value: value.nozzleTempMax, onChange: (nozzleTempMax) => onChange({ nozzleTempMax }) }}
      />
      {mark("nozzleTempMin", "nozzleTempMax")}
      <Temp
        label="Bed"
        min={{ value: value.bedTempMin, onChange: (bedTempMin) => onChange({ bedTempMin }) }}
        max={{ value: value.bedTempMax, onChange: (bedTempMax) => onChange({ bedTempMax }) }}
      />
      {mark("bedTempMin", "bedTempMax")}
      <div className="flex items-end gap-3">
        <TextField
          size="sm"
          label="Drying"
          aria-label="Drying temperature"
          inputMode="numeric"
          placeholder="°C"
          value={value.dryTempC ?? ""}
          onChange={(event) => onChange({ dryTempC: whole(event.target.value) })}
          className="w-24"
        />
        <TextField
          size="sm"
          aria-label="Drying hours"
          inputMode="numeric"
          placeholder="hours"
          value={value.dryHours ?? ""}
          onChange={(event) => onChange({ dryHours: whole(event.target.value) })}
          className="w-24"
        />
        <span className="text-small text-ink-faint pb-2">°C · hours</span>
      </div>
      {mark("dryTempC", "dryHours")}
      <TextField
        size="sm"
        label="Product code"
        mark={mark("productCode")}
        placeholder="RFID or product code, as printed"
        maxLength={80}
        value={value.productCode ?? ""}
        onChange={(event) => onChange({ productCode: event.target.value || null })}
      />
    </div>
  );
}
