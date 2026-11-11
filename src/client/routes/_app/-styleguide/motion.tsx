import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { ToggleChip } from "@/components/ui/Chip";
import { cn } from "@/lib/cn";
import { Panel, Section } from "./shared";

export function MotionSection() {
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
      <PressedPanel />
    </Section>
  );
}

/**
 * The pressed state, resting and held side by side (`data-pressed` holds the state for the picture; a real finger
 * does it with :active). Every tap shows within one frame, and `touch-action: manipulation` (in app.css) means no
 * double-tap-to-zoom wait.
 */
function PressedPanel() {
  const rows = [
    [
      "Button",
      (held?: boolean) => (
        <Button variant="primary" data-pressed={held || undefined}>
          Log attempt
        </Button>
      ),
    ],
    [
      "Chip",
      (held?: boolean) => (
        <ToggleChip selected={false} data-pressed={held || undefined}>
          Silk PLA
        </ToggleChip>
      ),
    ],
    [
      "Row or card",
      (held?: boolean) => (
        <button
          type="button"
          data-pressed={held || undefined}
          className="pressable focus-ring bg-cream shadow-soft text-body rounded-lg px-4 py-3 text-left font-semibold"
        >
          Tugboat hull
          <span className="text-small text-ink-faint block font-normal">3 attempts</span>
        </button>
      ),
    ],
    [
      "Link without .pressable",
      (held?: boolean) => (
        <a
          href="#motion"
          data-pressed={held || undefined}
          className="text-small text-ink-soft focus-ring rounded-xs underline"
        >
          See all in Builds
        </a>
      ),
    ],
  ] as const;
  return (
    <Panel className="flex min-w-0 flex-col gap-4">
      <p className="text-small text-ink-soft max-w-prose">
        Held: <code>pressable</code> shrinks to 97% in 90 ms; tappable things without it (inline links, plain rows) dim
        to 60%. Both start on the touch itself, never after it.
      </p>
      <div className="grid grid-cols-[8rem_1fr_1fr] items-center gap-x-4 gap-y-3 md:grid-cols-[12rem_1fr_1fr]">
        <span />
        <span className="text-caption text-ink-faint">Resting</span>
        <span className="text-caption text-ink-faint">Held</span>
        {rows.map(([name, specimen]) => (
          <div key={name} className="contents">
            <span className="text-small text-ink-faint">{name}</span>
            <div className="flex">{specimen()}</div>
            <div className="flex">{specimen(true)}</div>
          </div>
        ))}
      </div>
    </Panel>
  );
}
