import { cn } from "@/lib/cn";

/**
 * Something on its way that will happen by itself: a semolina dot that pulses. A pulse, not a spinner. `sm` (8 px)
 * sits before a line of small text (the 3D view's "Layer 140 of 317 · 1 h 45 min left" while a print is live).
 */
export function PulseDot({ size = "md", className }: { size?: "sm" | "md"; className?: string }) {
  return (
    <span
      className={cn(
        "bg-semolina sg-pulse inline-block shrink-0 rounded-full",
        size === "sm" ? "size-2" : "size-3",
        className,
      )}
      aria-hidden
    />
  );
}
