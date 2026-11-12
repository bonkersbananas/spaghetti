import { cn } from "@/lib/cn";
import { type IllustrationProps, svgProps } from "./index";

// Its own file: the shared illustrations load with every screen, this one only with the screens that draw it.
/** Builds: a filament spool with a loose strand curling off it. */
export function SpoolStrand({ className }: IllustrationProps) {
  return (
    <svg {...svgProps} className={cn("w-40", className)}>
      <ellipse cx="80" cy="108" rx="48" ry="5" className="fill-shade" stroke="none" />
      <circle cx="80" cy="60" r="44" className="fill-basil-soft" stroke="none" />
      <circle cx="66" cy="60" r="34" className="fill-cream stroke-ink" />
      <circle cx="66" cy="60" r="26" className="fill-basil stroke-ink" />
      <path d="M48 52c6-10 22-14 32-6M46 66c6 10 22 14 32 6" className="stroke-on-accent/40" />
      <circle cx="66" cy="60" r="9" className="fill-paper-deep stroke-ink" />
      <path
        d="M90 74c10 4 14 14 24 10s4-14 12-16 10 8 6 14-12 4-10-2 10-6 14 0"
        className="stroke-basil"
        strokeWidth="3"
      />
    </svg>
  );
}
