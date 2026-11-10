import type { Spool } from "@shared/api";
import { DRY_IT, needsDrying } from "@shared/drying";
import { DriedIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import { useDryingDays } from "@/lib/drying";
import { useNow } from "@/lib/use-now";

/** Whether this spool is past its material's dry window (the printer's own numbers, else the starting ones). */
export function useNeedsDrying(spool: Pick<Spool, "material" | "driedAt" | "createdAt" | "remaining">): boolean {
  const days = useDryingDays();
  const now = useNow(3_600_000);
  return needsDrying(spool, now, days);
}

/** "Dry it before printing": a plain fact in the quiet ink, not a warning. Nothing when the spool is fine. */
export default function DryItView({
  spool,
  className,
}: {
  spool: Pick<Spool, "material" | "driedAt" | "createdAt" | "remaining">;
  className?: string;
}) {
  if (!useNeedsDrying(spool)) return null;
  return (
    <span className={cn("text-small text-ink-soft inline-flex items-center gap-1.5", className)}>
      <DriedIcon size={14} aria-hidden />
      {DRY_IT}
    </span>
  );
}
