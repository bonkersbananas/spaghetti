import { cn } from "@/lib/cn";
import { Label, Panel, Section } from "./shared";

export function SpaceSection() {
  const steps = ["1", "2", "3", "4", "6", "8", "12", "16"] as const;
  const widths: Record<(typeof steps)[number], string> = {
    "1": "w-1",
    "2": "w-2",
    "3": "w-3",
    "4": "w-4",
    "6": "w-6",
    "8": "w-8",
    "12": "w-12",
    "16": "w-16",
  };
  const radii = [
    ["xs", "rounded-xs"],
    ["sm", "rounded-sm"],
    ["md", "rounded-md"],
    ["lg", "rounded-lg"],
    ["xl", "rounded-xl"],
    ["pill", "rounded-pill"],
  ] as const;
  return (
    <Section
      id="space"
      title="Space & radii"
      note="A 4 px grid (Tailwind's spacing scale). Prefer generous space to lines; round corners, softer as things get bigger."
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Panel>
          <Label>Spacing</Label>
          <div className="flex flex-col gap-2.5">
            {steps.map((step) => (
              <div key={step} className="flex items-center gap-4">
                <span className="tabular text-small text-ink-faint w-16">
                  {step} · {Number(step) * 4}px
                </span>
                <span className={cn("bg-tomato h-3 rounded-xs", widths[step])} />
              </div>
            ))}
          </div>
        </Panel>
        <Panel>
          <Label>Radii</Label>
          <div className="grid grid-cols-3 gap-4">
            {radii.map(([name, className]) => (
              <div key={name} className="flex flex-col items-center gap-2">
                <div className={cn("bg-semolina-soft shadow-well size-14", className)} />
                <span className="text-small text-ink-faint">{name}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </Section>
  );
}
