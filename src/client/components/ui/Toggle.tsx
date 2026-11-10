import type { ComponentPropsWithRef, ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface ToggleProps extends Omit<ComponentPropsWithRef<"button">, "onChange" | "role" | "children"> {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  /** One quiet line under the label: what it does, or why it can't be turned on. */
  hint?: ReactNode;
}

/**
 * An on/off setting that takes effect at once (no save button). The whole row is the switch, so it is a
 * big target on a phone; name it by its visible label.
 */
export function Toggle({ checked, onChange, label, hint, disabled, className, ...props }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "pressable focus-ring -mx-2 flex min-h-12 w-[calc(100%+1rem)] items-center gap-4 rounded-md px-2 py-2 text-left disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
      {...props}
    >
      <span className="min-w-0 flex-1">
        <span className="text-body text-ink block font-semibold">{label}</span>
        {hint && <span className="text-small text-ink-faint mt-0.5 block">{hint}</span>}
      </span>
      <span
        aria-hidden
        className={cn(
          "rounded-pill duration-fast relative h-7 w-12 shrink-0 transition-colors",
          checked ? "bg-tomato" : "bg-ink/20",
        )}
      >
        <span
          className={cn(
            "rounded-pill bg-lifted shadow-soft duration-fast absolute top-0.5 left-0.5 size-6 transition-transform ease-out",
            checked && "translate-x-5",
          )}
        />
      </span>
    </button>
  );
}
