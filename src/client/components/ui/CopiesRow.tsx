import { COPIES_MAX, type Copies } from "@shared/slicing/settings.ts";
import { ToggleChip } from "./Chip";
import { GridIcon } from "./icons";
import { Stepper } from "./Stepper";

interface CopiesRowProps {
  /** What is asked for: absent for one, a number, or "fit" for as many as the plate takes. */
  value: Copies | undefined;
  /** How many the slice there has (what "fit" came to); the number the stepper shows for "fit". */
  made?: number;
  onChange: (next: Copies | undefined) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * How many copies of a model print on one plate: a stepper (44 px at the thumb on phones; + and − on the keyboard) and
 * a "Fill the plate" chip for as many as fit. Stepping from "fit" settles on the number it came to, so a plus or minus
 * always starts from what the plate shows. One copy is no setting at all (`undefined`).
 */
export function CopiesRow({ value, made, onChange, disabled, className }: CopiesRowProps) {
  const fit = value === "fit";
  // "fit" before it is sliced has no number yet.
  const shown = fit ? (made ?? 1) : (value ?? 1);
  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-small text-ink-soft font-medium">Copies</span>
        <Stepper
          label="Copies"
          value={shown}
          min={1}
          max={COPIES_MAX}
          format={(n) => `× ${n}`}
          room={`× ${COPIES_MAX}`}
          disabled={disabled}
          onChange={(n) => onChange(n <= 1 ? undefined : n)}
        />
        <ToggleChip
          selected={fit}
          icon={GridIcon}
          disabled={disabled}
          onClick={() => onChange(fit ? (made && made > 1 ? made : undefined) : "fit")}
        >
          Fill the plate
        </ToggleChip>
      </div>
    </div>
  );
}
