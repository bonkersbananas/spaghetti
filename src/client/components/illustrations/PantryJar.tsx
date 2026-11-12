import { cn } from "@/lib/cn";
import { type IllustrationProps, svgProps } from "./index";

// Its own file: the shared illustrations load with every screen, this one only with the screens that draw it.
/** The pantry: a storage jar with a label and a few dry noodles, waiting for spools. */
export function PantryJar({ className }: IllustrationProps) {
  return (
    <svg {...svgProps} className={cn("w-40", className)}>
      <ellipse cx="80" cy="108" rx="48" ry="5" className="fill-shade" stroke="none" />
      <circle cx="80" cy="60" r="44" className="fill-semolina-soft" stroke="none" />
      <rect x="58" y="16" width="44" height="12" rx="4" className="fill-tomato stroke-ink" />
      <path
        d="M54 34c0-4 3-6 6-6h40c3 0 6 2 6 6v62c0 6-4 10-10 10H64c-6 0-10-4-10-10V34Z"
        className="fill-cream stroke-ink"
      />
      <path d="M66 48l-4 50M74 46l1 52M82 47l5 51M90 46l-1 52" className="stroke-semolina" strokeWidth="3" />
      <rect x="60" y="60" width="40" height="20" rx="4" className="fill-paper stroke-ink" />
      <path d="M68 70h24" className="stroke-ink-ghost" />
      <path d="M112 86a10 10 0 1 0 0.1 0" className="fill-basil stroke-ink" />
      <circle cx="112" cy="96" r="3.5" className="fill-paper-deep stroke-ink" />
    </svg>
  );
}
