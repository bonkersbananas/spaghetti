import { useState } from "react";
import { AutoHeight } from "@/components/ui/AutoHeight";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { Label, Panel, Section } from "./shared";

export function MotionSection() {
  const [tall, setTall] = useState(false);
  const [on, setOn] = useState(false);
  const durations = [
    ["instant", "duration-instant", "90 ms · press"],
    ["fast", "duration-fast", "160 ms · hover, fades"],
    ["base", "duration-base", "240 ms · sheets in"],
    ["slow", "duration-slow", "420 ms · page entrances"],
  ] as const;
  return (
    <Section
      id="motion"
      title="Motion"
      note="Quick and soft: ease-out for things arriving, a small press on everything tappable, nothing that delays reading. Reduced-motion settings turn movement off."
    >
      <Panel className="flex min-w-0 flex-col gap-4">
        <div>
          <Button size="sm" onClick={() => setOn((v) => !v)}>
            {on ? "Back" : "Play"}
          </Button>
        </div>
        {durations.map(([name, className, note]) => (
          <div key={name} className="flex items-center gap-4">
            <span className="text-small text-ink-faint w-40 shrink-0">{note}</span>
            <div className="rounded-pill bg-paper shadow-well relative h-8 flex-1">
              <span
                className={cn(
                  "bg-tomato absolute top-1 left-1 size-6 rounded-full transition-transform ease-out",
                  className,
                  on && "translate-x-40 md:translate-x-80",
                )}
              />
            </div>
            <span className="sr-only">{name}</span>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <span className="text-small text-ink-faint">Press and hold:</span>
          <button
            type="button"
            className="pressable focus-ring bg-paper text-small shadow-soft rounded-md px-4 py-2.5 font-semibold"
          >
            .pressable
          </button>
        </div>
      </Panel>
      <Label>AutoHeight: a box that grows to fit what it holds (Today's next print becoming the big card)</Label>
      <Panel className="flex flex-col items-start gap-4">
        <Button variant="secondary" size="sm" onClick={() => setTall((current) => !current)}>
          {tall ? "Make it short" : "Make it tall"}
        </Button>
        <AutoHeight className="w-full max-w-sm">
          <div className={cn("bg-paper rounded-lg p-4", tall ? "h-48" : "h-16")}>
            <p className="text-small text-ink-soft">{tall ? "Grown, by its real height." : "Short."}</p>
          </div>
        </AutoHeight>
      </Panel>
    </Section>
  );
}
