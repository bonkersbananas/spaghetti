import { useState } from "react";
import { AutoHeight } from "@/components/ui/AutoHeight";
import { Button } from "@/components/ui/Button";
import { ToggleChip } from "@/components/ui/Chip";
import { IdeasIcon } from "@/components/ui/icons";
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
      <div id="pressed">
        <PressedPanel />
      </div>
      <Label>AutoHeight: a box that grows to fit what it holds (Today's next print becoming the big card)</Label>
      <Panel className="flex flex-col items-start gap-4">
        <Button variant="secondary" size="sm" onClick={() => setTall((current) => !current)}>
          {tall ? "Make it short" : "Make it tall"}
        </Button>
        <AutoHeight trigger={tall} className="w-full max-w-sm">
          <div className={cn("bg-paper rounded-lg p-4", tall ? "h-48" : "h-16")}>
            <p className="text-small text-ink-soft">{tall ? "Grown, by its real height." : "Short."}</p>
          </div>
        </AutoHeight>
      </Panel>
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
      "Primary button · shrinks, deeper tomato",
      (held?: boolean) => (
        <Button variant="primary" data-pressed={held || undefined}>
          Log attempt
        </Button>
      ),
    ],
    [
      "Chip · shrinks, veil",
      (held?: boolean) => (
        <ToggleChip selected={false} data-pressed={held || undefined}>
          Silk PLA
        </ToggleChip>
      ),
    ],
    [
      "Selected chip · keeps its tone",
      (held?: boolean) => (
        <ToggleChip selected data-pressed={held || undefined}>
          Silk PLA
        </ToggleChip>
      ),
    ],
    [
      "Danger button · deepens, text turns light",
      (held?: boolean) => (
        <Button variant="danger" data-pressed={held || undefined}>
          Delete
        </Button>
      ),
    ],
    [
      "Card or row · shrinks, veil",
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
      "Tab bar item · round highlight",
      (held?: boolean) => (
        <button
          type="button"
          data-pressed={held || undefined}
          className="pressable press-none focus-ring group text-ink-faint flex w-16 flex-col items-center gap-0.5 rounded-md"
        >
          <span className="group-data-[pressed]:bg-pressed rounded-pill flex h-8 w-12 items-center justify-center">
            <IdeasIcon size={26} aria-hidden />
          </span>
          <span className="text-caption font-semibold">Ideas</span>
        </button>
      ),
    ],
    [
      "Link, not pressable · dims",
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
        Held: <code>pressable</code> shrinks to 97% and takes a tint in 90 ms (a primary button deepens to the pressed
        tomato, chips, cards and rows to a veil of their own text colour, so selected and toned ones keep their tone, a
        tab bar item gets a round highlight); tappable things without it (inline links, plain rows) dim to 60%. Both
        start on the touch itself, never after it.
      </p>
      <div className="bg-paper grid max-w-lg grid-cols-2 items-center gap-x-4 gap-y-2 rounded-md p-4">
        <span className="text-caption text-ink font-semibold">Resting</span>
        <span className="text-caption text-ink font-semibold">Held</span>
        {rows.map(([name, specimen]) => (
          <div key={name} className="contents">
            <span className="text-small text-ink-faint col-span-2 mt-3">{name}</span>
            <div className="flex min-w-0">{specimen()}</div>
            <div className="flex min-w-0">{specimen(true)}</div>
          </div>
        ))}
      </div>
    </Panel>
  );
}
