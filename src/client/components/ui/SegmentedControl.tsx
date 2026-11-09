import { useId } from "react";
import { cn } from "@/lib/cn";
import type { Icon } from "./icons";

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: Icon;
}

interface SegmentedControlProps<T extends string> {
  options: readonly SegmentOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  /** Names the group for screen readers. */
  label: string;
  size?: "sm" | "md";
  className?: string;
}

/**
 * Two to four choices side by side, one of them on: main or auxiliary
 * nozzle, no / normal / tree supports, or where a capture goes. A well with
 * the chosen segment raised on cream. Arrow keys move between segments.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  size = "md",
  className,
}: SegmentedControlProps<T>) {
  const name = useId();
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn("bg-ink/5 shadow-well inline-flex gap-0.5 rounded-md p-0.5", className)}
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        const IconComponent = option.icon;
        return (
          // biome-ignore lint/a11y/useSemanticElements: segments are buttons with roving focus, styled as one control.
          <button
            key={option.value}
            type="button"
            role="radio"
            name={name}
            aria-checked={selected}
            tabIndex={selected || (value === null && index === 0) ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => {
              if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
              event.preventDefault();
              event.stopPropagation();
              const step = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
              const next = options[(index + step + options.length) % options.length];
              if (!next) return;
              onChange(next.value);
              const buttons = event.currentTarget.parentElement?.querySelectorAll("button");
              buttons?.[options.indexOf(next)]?.focus();
            }}
            className={cn(
              "pressable focus-ring inline-flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-sm px-3 font-semibold whitespace-nowrap",
              size === "md" ? "text-body h-10 md:h-9" : "text-small h-9 md:h-8",
              selected ? "bg-cream text-ink shadow-soft" : "text-ink-faint hover:text-ink",
            )}
          >
            {IconComponent && (
              <IconComponent size={size === "md" ? 18 : 16} weight={selected ? "fill" : "regular"} aria-hidden />
            )}
            <span className="truncate">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
