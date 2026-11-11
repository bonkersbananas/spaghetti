import { dueLine } from "@shared/upkeep";
import { Link } from "@tanstack/react-router";
import { ClockIcon } from "@/components/ui/icons";
import { QuietRowContent, quietRowClass } from "@/components/ui/QuietRow";
import { useDueUpkeep } from "@/lib/upkeep";

/** At most one quiet line when something is due, leading to the Printer page. Nothing when all is well. */
export default function UpkeepLine() {
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
    <Link to="/printer" className={quietRowClass}>
      <QuietRowContent icon={ClockIcon}>
        <span className="text-ink font-semibold">{line.text}</span>
        {line.more && <span className="text-ink-faint">. {line.more}</span>}
      </QuietRowContent>
    </Link>
  );
}
