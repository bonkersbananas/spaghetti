import { cn } from "@/lib/cn";

/**
 * A small ring: filled to `value` (0–1), or spinning when it isn't known.
 * 16 px by default; give it a `size-*` class to resize. It takes its color
 * from the text color.
 */
export function ProgressRing({ value, className }: { value: number | null; className?: string }) {
  const radius = 6;
  const circumference = 2 * Math.PI * radius;
  const shown = value === null ? 0.28 : Math.max(0.06, value);
  return (
    <svg
      viewBox="0 0 16 16"
      className={cn("size-4 -rotate-90", value === null && "animate-spin", className)}
      aria-hidden
    >
      <circle cx="8" cy="8" r={radius} fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <circle
        cx="8"
        cy="8"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - shown)}
        className="duration-base transition-[stroke-dashoffset] ease-out"
      />
    </svg>
  );
}
