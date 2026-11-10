import type { UpkeepTask } from "@shared/api";
import { formatHours, progressWords } from "@shared/upkeep";
import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense, useState } from "react";
import { Button } from "@/components/ui/Button";
import { CheckIcon, PlusIcon } from "@/components/ui/icons";
import { Section } from "@/components/ui/Section";
import { Skeleton } from "@/components/ui/Skeleton";
import { UpkeepMeter } from "@/components/ui/UpkeepMeter";
import { useReadOnly } from "@/lib/read-only";
import { upkeepQuery } from "@/lib/upkeep";

// The sheets are only needed once someone taps: they stay out of the Printer page's first load.
const DoneSheet = lazy(() => import("./UpkeepSheets").then((m) => ({ default: m.DoneSheet })));
const TaskSheet = lazy(() => import("./UpkeepSheets").then((m) => ({ default: m.TaskSheet })));

type Open = { kind: "done"; id: string } | { kind: "edit"; id: string } | { kind: "new" } | null;

/** The sentence under a task's name. */
export function upkeepRowText(task: UpkeepTask): string {
  const progress = progressWords(
    task,
    { fraction: task.fraction, due: task.due, by: task.by },
    task.sinceHours,
    task.sinceDays,
  );
  if (!task.due) return progress;
  const over =
    task.by === "hours" && task.intervalHours
      ? task.sinceHours - task.intervalHours
      : task.sinceDays - (task.intervalDays ?? 0);
  const unit = task.by === "hours" ? "print hours" : "days";
  return `Due ${Math.max(1, Math.floor(over))} ${unit} ago`;
}

/**
 * What the printer needs now and then, most due first: each task with how far it is through its interval and
 * Done right there. Tapping the name opens it (interval, history). Nothing here nags; due is a fact.
 */
export function Upkeep() {
  const { data, isPending } = useQuery(upkeepQuery);
  const readOnly = useReadOnly();
  const [open, setOpen] = useState<Open>(null);
  const tasks = data?.tasks ?? [];
  const current = open && open.kind !== "new" ? tasks.find((task) => task.id === open.id) : undefined;

  return (
    <Section
      id="printer-upkeep"
      title="Upkeep"
      aside={
        data && (
          <span className="text-small text-ink-faint tabular" data-testid="print-hours">
            {formatHours(data.printHours)} of printing so far
          </span>
        )
      }
    >
      {isPending ? (
        <Skeleton className="h-52 w-full rounded-xl" aria-hidden />
      ) : (
        <ul className="bg-cream shadow-soft overflow-hidden rounded-lg" aria-label="Upkeep tasks">
          {tasks.map((task) => (
            <li
              key={task.id}
              className="after:bg-hairline relative flex items-center gap-3 px-4 py-3 after:absolute after:inset-x-4 after:bottom-0 after:h-px last:after:hidden"
            >
              <button
                type="button"
                onClick={() => setOpen({ kind: "edit", id: task.id })}
                className="focus-ring hover:bg-ink/4 duration-fast -mx-2 flex min-h-12 min-w-0 flex-1 flex-col justify-center gap-1.5 rounded-md px-2 py-1 text-left transition-colors"
              >
                <span className="text-body text-ink truncate font-semibold">{task.name}</span>
                <UpkeepMeter fraction={task.fraction} label={upkeepRowText(task)} />
                <span className="text-small text-ink-faint tabular truncate">{upkeepRowText(task)}</span>
              </button>
              <Button
                variant="secondary"
                size="sm"
                icon={CheckIcon}
                disabled={readOnly}
                aria-label={`Done: ${task.name}`}
                onClick={() => setOpen({ kind: "done", id: task.id })}
              >
                Done
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Button
        variant="quiet"
        size="sm"
        icon={PlusIcon}
        disabled={readOnly}
        className="self-start"
        onClick={() => setOpen({ kind: "new" })}
      >
        Add a task
      </Button>
      <Suspense fallback={null}>
        {current && open?.kind === "done" && (
          <DoneSheet task={current} onOpenChange={(next) => !next && setOpen(null)} />
        )}
        {(open?.kind === "new" || (current && open?.kind === "edit")) && (
          <TaskSheet task={current ?? null} onOpenChange={(next) => !next && setOpen(null)} />
        )}
      </Suspense>
    </Section>
  );
}
