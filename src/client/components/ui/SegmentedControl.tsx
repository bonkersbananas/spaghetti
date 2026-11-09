import { type ReactNode, useId } from "react";
import { cn } from "@/lib/cn";
import type { Icon } from "./icons";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: Icon;
}

interface SegmentedControlProps<T extends string> {
  /** Names the group: "Appearance". */
  label: ReactNode;
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

/**
 * Pick one of a few short options (appearance: light, dark, system). A
 * recessed channel with a lifted thumb under the chosen one. Real radio
 * inputs underneath, so arrow keys and screen readers work as they should.
 */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: SegmentedControlProps<T>) {
  const name = useId();
  return (
    <fieldset className={cn("flex min-w-0 flex-col gap-2", className)}>
      <legend className="text-small text-ink-faint mb-2 font-medium">{label}</legend>
      <div className="bg-well shadow-well flex gap-1 rounded-md p-1">
        {options.map(({ value: optionValue, label: optionLabel, icon: IconComponent }) => {
          const selected = optionValue === value;
          return (
            <label
              key={optionValue}
              className={cn(
                "pressable text-small has-focus-visible:shadow-ring relative flex h-10 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-sm font-semibold md:h-8",
                selected ? "bg-lifted text-ink shadow-soft" : "text-ink-faint hover:text-ink",
              )}
            >
              <input
                type="radio"
                name={name}
                value={optionValue}
                checked={selected}
                onChange={() => onChange(optionValue)}
                className="absolute inset-0 cursor-pointer opacity-0"
              />
              {IconComponent && <IconComponent size={16} weight={selected ? "fill" : "regular"} aria-hidden />}
              {optionLabel}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
