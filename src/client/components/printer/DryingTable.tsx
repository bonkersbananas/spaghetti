import { DRYING_DAYS, DRYING_MATERIALS } from "@shared/drying";
import { NumberField } from "@/components/ui/Field";

/**
 * How long each material stays dry, in days: the starting values with this printer's own laid over. Edits are
 * kept as overrides, so a number set back to the starting one drops its override.
 */
export function DryingTable({
  days,
  onChange,
  disabled,
}: {
  days: Record<string, number>;
  onChange: (overrides: Record<string, number>) => void;
  disabled?: boolean;
}) {
  const set = (material: string, value: number | undefined) => {
    const next = { ...days };
    if (value === undefined || value === DRYING_DAYS[material]) delete next[material];
    else next[material] = value;
    // Only what differs from the starting values is kept.
    onChange(Object.fromEntries(Object.entries(next).filter(([key, v]) => DRYING_DAYS[key] !== v)));
  };
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
      {DRYING_MATERIALS.map((material) => (
        <NumberField
          key={material}
          label={material}
          suffix="days"
          size="sm"
          min={1}
          max={365}
          disabled={disabled}
          value={days[material] ?? DRYING_DAYS[material]}
          onChange={(value) => set(material, value)}
        />
      ))}
    </div>
  );
}
