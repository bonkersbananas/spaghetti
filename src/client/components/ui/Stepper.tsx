import { cn } from "@/lib/cn";
import { MinusIcon, PlusIcon } from "./icons";

interface StepperProps {
  value: number;
  onChange: (value: number) => void;
  /** What is counted, for people using a screen reader: "Hull half". */
  label: string;
  min?: number;
  max?: number;
  /** How far one press goes: 5 for an infill's percent. A value off the steps goes to the next one. */
  step?: number;
  /** How the number reads: "15%". */
  format?: (value: number) => string;
  disabled?: boolean;
  className?: string;
}

const button =
  "pressable focus-ring text-ink-soft hover:text-ink flex size-11 items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-40 md:size-8";

/**
 * A small count to nudge: minus, the number, plus. Thumb-sized on phones (44 px), compact on desktop, where the
 * arrow keys on the number also step it. Used for quantities ("Hull half ×2") and pieces that came out.
 */
export function Stepper({
  value,
  onChange,
  label,
  min = 0,
  max = 999,
  step = 1,
  format = String,
  disabled,
  className,
}: StepperProps) {
  const set = (next: number) => onChange(Math.max(min, Math.min(max, next)));
  // From a value between steps (a project's 12%), a press goes to the step on that side (10% or 15%).
  const down = () => set(value % step ? Math.floor(value / step) * step : value - step);
  const up = () => set(value % step ? Math.ceil(value / step) * step : value + step);
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
        title="One fewer"
        disabled={disabled || value <= min}
        onClick={down}
        className={button}
      >
        <MinusIcon size={16} weight="bold" aria-hidden />
      </button>
      <span
        role="spinbutton"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuenow={value}
        aria-valuetext={format(value)}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-disabled={disabled || undefined}
        onKeyDown={(event) => {
          if (disabled) return;
          if (event.key === "ArrowUp" || event.key === "ArrowRight") {
            event.preventDefault();
            up();
          }
          if (event.key === "ArrowDown" || event.key === "ArrowLeft") {
            event.preventDefault();
            down();
          }
        }}
        className="text-body tabular text-ink focus-ring md:text-small min-w-6 rounded-xs px-0.5 text-center font-semibold"
      >
        {format(value)}
      </span>
      <button
        type="button"
        aria-label={`${label}: one more`}
        title="One more"
        disabled={disabled || value >= max}
        onClick={up}
        className={button}
      >
        <PlusIcon size={16} weight="bold" aria-hidden />
      </button>
    </div>
  );
}
