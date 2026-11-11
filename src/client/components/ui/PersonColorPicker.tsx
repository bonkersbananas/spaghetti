import { PERSON_COLORS, type PersonColor } from "@shared/people";
import { cn } from "@/lib/cn";
import { CheckIcon } from "./icons";

const fills: Record<PersonColor, string> = {
  tomato: "bg-person-tomato",
  basil: "bg-person-basil",
  semolina: "bg-person-semolina",
  plum: "bg-person-plum",
  sea: "bg-person-sea",
  clay: "bg-person-clay",
};

interface PersonColorPickerProps {
  value: PersonColor;
  onChange: (color: PersonColor) => void;
  /** Names the group for a screen reader. */
  label?: string;
  className?: string;
}

/** The six colors a person can be, as round swatches to tap (one choice, arrow keys move between them). */
export function PersonColorPicker({ value, onChange, label = "Your color", className }: PersonColorPickerProps) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("flex flex-wrap gap-2.5", className)}>
      {PERSON_COLORS.map((color) => {
        const selected = color === value;
        return (
          // biome-ignore lint/a11y/useSemanticElements: a swatch is a round radio; the group is a radiogroup
          <button
            key={color}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={color}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(color)}
            onKeyDown={(event) => {
              const step =
                event.key === "ArrowRight" || event.key === "ArrowDown"
                  ? 1
                  : event.key === "ArrowLeft" || event.key === "ArrowUp"
                    ? -1
                    : 0;
              if (!step) return;
              event.preventDefault();
              const next =
                PERSON_COLORS[(PERSON_COLORS.indexOf(color) + step + PERSON_COLORS.length) % PERSON_COLORS.length];
              if (next) {
                onChange(next);
                (
                  event.currentTarget.parentElement?.querySelector(`[aria-label="${next}"]`) as HTMLElement | null
                )?.focus();
              }
            }}
            className={cn(
              "pressable focus-ring text-on-accent touch-target relative grid size-9 place-items-center rounded-full",
              fills[color],
              selected && "ring-ink ring-offset-cream ring-2 ring-offset-2",
            )}
          >
            {selected && <CheckIcon size={16} weight="bold" aria-hidden />}
          </button>
        );
      })}
    </div>
  );
}
