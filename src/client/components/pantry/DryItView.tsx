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
  compact = false,
}: {
  spool: Pick<Spool, "material" | "driedAt" | "createdAt" | "remaining">;
  className?: string;
  /** In a narrow column (an AMS bay on a phone) it says "Dry first" in one line; from `lg` the whole sentence. */
  compact?: boolean;
}) {
  if (!useNeedsDrying(spool)) return null;
  return (
    <span className={cn("text-small text-ink-soft inline-flex items-center gap-1.5", className)}>
      <DriedIcon size={14} aria-hidden />
      {compact ? (
        <>
          <span className="whitespace-nowrap lg:hidden">Dry first</span>
          <span className="hidden lg:inline">{DRY_IT}</span>
        </>
      ) : (
        DRY_IT
      )}
    </span>
  );
}
