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
  unit = "°C",
  mark,
  first,
  second,
}: {
  label: string;
  unit?: string;
  mark?: ReactNode;
  first: { name: string; placeholder: string; value: number | null; onChange: (value: number | null) => void };
  second: { name: string; placeholder: string; value: number | null; onChange: (value: number | null) => void };
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-baseline gap-2 px-0.5">
        <span className="text-small text-ink-soft font-semibold">{label}</span>
        {mark}
      </span>
      <div className="flex items-center gap-2">
        {[first, second].map((field, index) => (
          <span key={field.name} className="contents">
            {index === 1 && (
              <span className="text-ink-faint" aria-hidden>
                {unit === "°C" ? "–" : "·"}
              </span>
            )}
            <TextField
              size="sm"
              aria-label={field.name}
              inputMode="numeric"
              placeholder={field.placeholder}
              value={field.value ?? ""}
              onChange={(event) => field.onChange(whole(event.target.value))}
              className="w-24"
            />
          </span>
        ))}
        <span className="text-small text-ink-faint">{unit}</span>
      </div>
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
        mark={mark("nozzleTempMin", "nozzleTempMax")}
        first={{
          name: "Nozzle, from",
          placeholder: "from",
          value: value.nozzleTempMin,
          onChange: (nozzleTempMin) => onChange({ nozzleTempMin }),
        }}
        second={{
          name: "Nozzle, to",
          placeholder: "to",
          value: value.nozzleTempMax,
          onChange: (nozzleTempMax) => onChange({ nozzleTempMax }),
        }}
      />
      <Temp
        label="Bed"
        mark={mark("bedTempMin", "bedTempMax")}
        first={{
          name: "Bed, from",
          placeholder: "from",
          value: value.bedTempMin,
          onChange: (bedTempMin) => onChange({ bedTempMin }),
        }}
        second={{
          name: "Bed, to",
          placeholder: "to",
          value: value.bedTempMax,
          onChange: (bedTempMax) => onChange({ bedTempMax }),
        }}
      />
      <Temp
        label="Drying"
        unit="°C · hours"
        mark={mark("dryTempC", "dryHours")}
        first={{
          name: "Drying temperature",
          placeholder: "°C",
          value: value.dryTempC,
          onChange: (dryTempC) => onChange({ dryTempC }),
        }}
        second={{
          name: "Drying hours",
          placeholder: "hours",
          value: value.dryHours,
          onChange: (dryHours) => onChange({ dryHours }),
        }}
      />
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
