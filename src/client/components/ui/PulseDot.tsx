import { cn } from "@/lib/cn";

/** Something on its way that will happen by itself: a semolina dot that pulses. A pulse, not a spinner. */
export function PulseDot({ className }: { className?: string }) {
  return (
    <span className={cn("bg-semolina sg-pulse inline-block size-3 shrink-0 rounded-full", className)} aria-hidden />
  );
}
