import { type ReactNode, useId } from "react";
import { cn } from "@/lib/cn";
import type { Icon } from "./icons";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: Icon;
  /**
   * A small dot after the label, for what is "in use" among the options: solid for the one that is, a ring for one
   * that is too. Its words are read out (`markWords`: "main nozzle"), the legend is the caller's to give.
   */
  mark?: "solid" | "ring";
  markWords?: string;
}

interface SegmentedControlProps<T extends string> {
  /** Names the group: "Appearance", "Nozzle". */
  label: ReactNode;
  /** Keep the name for screen readers only, where a heading above already says it. */
  labelHidden?: boolean;
  options: readonly SegmentedOption<T>[];
  /** null: nothing picked yet. */
  value: T | null;
  onChange: (value: T) => void;
  className?: string;
}

/**
 * Pick one of a few short options (appearance: light, dark, system; main or
 * auxiliary nozzle; where a capture goes). A recessed channel with a lifted
 * thumb under the chosen one. Real radio inputs underneath, so arrow keys
 * and screen readers work as they should.
 */
export function SegmentedControl<T extends string>({
  label,
  labelHidden = false,
  options,
  value,
  onChange,
  className,
}: SegmentedControlProps<T>) {
  const name = useId();
  return (
    <fieldset className={cn("flex min-w-0 flex-col gap-2", className)}>
      <legend className={labelHidden ? "sr-only" : "text-small text-ink-faint mb-2 font-medium"}>{label}</legend>
      <div className="bg-well shadow-well flex gap-1 rounded-md p-1">
        {options.map(({ value: optionValue, label: optionLabel, icon: IconComponent, mark, markWords }) => {
          const selected = optionValue === value;
          return (
            <label
              key={optionValue}
              className={cn(
                "pressable has-focus-visible:shadow-ring relative flex min-w-0 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-sm font-semibold whitespace-nowrap",
                // 44 px on phones (a touch-target overlay would sit over the radio and take its clicks); compact on desktop.
                "text-small h-11 md:h-8",
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
              <span className="truncate">{optionLabel}</span>
              {mark && (
                <>
                  <span
                    aria-hidden
                    className={cn(
                      "size-2 shrink-0 rounded-full",
                      mark === "solid" ? "bg-semolina" : "ring-semolina ring-[1.5px] ring-inset",
                    )}
                  />
                  {markWords && <span className="sr-only">({markWords})</span>}
                </>
              )}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
