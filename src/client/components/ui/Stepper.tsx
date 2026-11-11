import { cn } from "@/lib/cn";
import { MinusIcon, PlusIcon } from "./icons";

interface StepperProps {
  value: number;
  onChange: (value: number) => void;
  /** What is counted, for people using a screen reader: "Hull half". */
  label: string;
  min?: number;
  max?: number;
  disabled?: boolean;
  className?: string;
}

const button =
  "pressable focus-ring text-ink-soft hover:text-ink flex size-11 items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-40 md:size-8";

/**
 * A small count to nudge: minus, the number, plus. Thumb-sized on phones (44 px), compact on desktop, where the
 * arrow keys on the number also step it. Used for quantities ("Hull half ×2") and pieces that came out.
 */
export function Stepper({ value, onChange, label, min = 0, max = 999, disabled, className }: StepperProps) {
  const set = (next: number) => onChange(Math.max(min, Math.min(max, next)));
  return (
    // biome-ignore lint/a11y/useSemanticElements: an inline pill of buttons, not a form group.
    <div
      role="group"
      aria-label={label}
      className={cn("bg-ink/4 shadow-well rounded-pill inline-flex items-center", className)}
    >
      <button
        type="button"
        aria-label={`${label}: one fewer`}
        disabled={disabled || value <= min}
        onClick={() => set(value - 1)}
        className={button}
      >
        <MinusIcon size={16} weight="bold" aria-hidden />
      </button>
      <span
        role="spinbutton"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-disabled={disabled || undefined}
        onKeyDown={(event) => {
          if (disabled) return;
          if (event.key === "ArrowUp" || event.key === "ArrowRight") {
            event.preventDefault();
            set(value + 1);
          }
          if (event.key === "ArrowDown" || event.key === "ArrowLeft") {
            event.preventDefault();
            set(value - 1);
          }
        }}
        className="text-body tabular text-ink focus-ring md:text-small min-w-6 rounded-xs text-center font-semibold"
      >
        {value}
      </span>
      <button
        type="button"
        aria-label={`${label}: one more`}
        disabled={disabled || value >= max}
        onClick={() => set(value + 1)}
        className={button}
      >
        <PlusIcon size={16} weight="bold" aria-hidden />
      </button>
    </div>
  );
}
