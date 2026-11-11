import { SparkleIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";

/** "Reading the label…": a pulse, not a spinner. */
export function ReadingLine({ className }: { className?: string }) {
  return (
    <p className={cn("text-small text-ink-soft flex items-center gap-2", className)} role="status">
      <SparkleIcon size={16} weight="fill" aria-hidden className="sg-pulse shrink-0" />
      Reading the label…
    </p>
  );
}
