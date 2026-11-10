import { dueLine } from "@shared/upkeep";
import { Link } from "@tanstack/react-router";
import { WrenchIcon } from "@/components/ui/icons";
import { useDueUpkeep } from "@/lib/upkeep";

/** At most one quiet line when something is due, leading to the Printer page. Nothing when all is well. */
export function UpkeepLine() {
  const due = useDueUpkeep();
  const line = dueLine(
    due.map((task) => ({
      name: task.name,
      status: { fraction: task.fraction, due: task.due, by: task.by },
      sinceHours: task.sinceHours,
      sinceDays: task.sinceDays,
    })),
  );
  if (!line) return null;
  return (
    <Link
      to="/printer"
      className="focus-ring text-small text-ink-soft hover:text-ink duration-fast hover:bg-ink/4 -mx-2 flex min-h-11 items-center gap-2 rounded-md px-2 transition-colors"
    >
      <WrenchIcon size={16} className="shrink-0" aria-hidden />
      {line}
    </Link>
  );
}
