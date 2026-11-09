import type { ComponentPropsWithRef, ReactNode } from "react";
import { cn } from "@/lib/cn";
import type { Icon } from "./icons";

export type ChipTone = "neutral" | "tomato" | "basil" | "semolina";

const tones: Record<ChipTone, string> = {
  neutral: "bg-ink/6 text-ink-soft",
  tomato: "bg-tomato-soft text-tomato-ink",
  basil: "bg-basil-soft text-basil-ink",
  semolina: "bg-semolina-soft text-semolina-ink",
};

const base = "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-pill px-2.5 text-small font-semibold md:h-6";

interface ChipProps {
  tone?: ChipTone;
  icon?: Icon;
  children: ReactNode;
  className?: string;
}

/** A label: status, material, tag. Static; for filters use ToggleChip. */
export function Chip({ tone = "neutral", icon: IconComponent, children, className }: ChipProps) {
  return (
    <span className={cn(base, tones[tone], className)}>
      {IconComponent && <IconComponent size={14} weight="bold" aria-hidden />}
      {children}
    </span>
  );
}

interface ToggleChipProps extends Omit<ComponentPropsWithRef<"button">, "children"> {
  selected: boolean;
  icon?: Icon;
  /** How it looks when picked: ink (filters), or a tone for tags (a failure in tomato, a success in basil). */
  tone?: ChipTone;
  children: ReactNode;
}

const selectedTones: Record<ChipTone, string> = {
  neutral: "bg-select text-on-select",
  tomato: "bg-tomato-soft text-tomato-ink ring-1 ring-inset ring-tomato/40",
  basil: "bg-basil-soft text-basil-ink ring-1 ring-inset ring-basil/40",
  semolina: "bg-semolina-soft text-semolina-ink ring-1 ring-inset ring-semolina/50",
};

/** A chip people tap to filter or pick. */
export function ToggleChip({
  selected,
  icon: IconComponent,
  tone = "neutral",
  children,
  className,
  ...props
}: ToggleChipProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        base,
        "pressable focus-ring h-9 px-3.5 md:h-8",
        selected ? selectedTones[tone] : "bg-cream text-ink-soft shadow-soft hover:text-ink",
        className,
      )}
      {...props}
    >
      {IconComponent && <IconComponent size={16} weight={selected ? "fill" : "regular"} aria-hidden />}
      {children}
    </button>
  );
}
