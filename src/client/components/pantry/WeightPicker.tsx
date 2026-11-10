import { DEFAULT_NET_GRAMS, MAX_SPOOL_GRAMS, NET_WEIGHT_PRESETS } from "@shared/ledger";
import { useState } from "react";
import { ToggleChip } from "@/components/ui/Chip";
import { NumberField } from "@/components/ui/Field";

/**
 * What a spool held when new: the common sizes as chips (1 kg is what Bambu sells), or any number.
 * "None" leaves the spool without gram data, so its level stays hand-set.
 */
export function WeightPicker({
  value,
  onChange,
  allowNone = true,
}: {
  value: number | null;
  onChange: (grams: number | null) => void;
  allowNone?: boolean;
}) {
  const preset = value !== null && (NET_WEIGHT_PRESETS as readonly number[]).includes(value);
  const [custom, setCustom] = useState(value !== null && !preset);
  return (
    <div className="flex flex-col gap-3">
      {/* biome-ignore lint/a11y/useSemanticElements: a row of chips, not a form field set. */}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Weight when new">
        {NET_WEIGHT_PRESETS.map((grams) => (
          <ToggleChip
            key={grams}
            selected={!custom && value === grams}
            onClick={() => {
              setCustom(false);
              onChange(grams);
            }}
            className="tabular"
          >
            {grams >= 1000 ? `${grams / 1000} kg` : `${grams} g`}
          </ToggleChip>
        ))}
        <ToggleChip
          selected={custom}
          onClick={() => {
            setCustom(true);
            if (value === null) onChange(DEFAULT_NET_GRAMS);
          }}
        >
          Other
        </ToggleChip>
        {allowNone && (
          <ToggleChip
            selected={value === null}
            onClick={() => {
              setCustom(false);
              onChange(null);
            }}
          >
            Not tracked
          </ToggleChip>
        )}
      </div>
      {custom && (
        <NumberField
          size="sm"
          aria-label="Weight when new"
          suffix="g"
          min={1}
          max={MAX_SPOOL_GRAMS}
          autoFocus
          value={value ?? undefined}
          onChange={(grams) => grams && onChange(grams)}
          className="max-w-40"
        />
      )}
    </div>
  );
}
