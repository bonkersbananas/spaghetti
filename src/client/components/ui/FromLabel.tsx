import { SparkleIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";

/**
 * "from the label": the quiet marker on a value Claude read off a label photo, until the person touches it (the
 * way a suggested tag is marked, but for text). Faint, small, never in the way of the value itself.
 */
export function FromLabel({ className }: { className?: string }) {
  return (
    <span className={cn("text-caption text-ink-faint inline-flex items-center gap-1 font-medium", className)}>
      <SparkleIcon size={12} weight="fill" aria-hidden />
      from the label
    </span>
  );
}
