import { cn } from "@/lib/cn";
import { type IllustrationProps, svgProps } from "./index";

// Its own file: the shared illustrations load with every screen, this one only with the screens that draw it.
/** Journal: an open notebook, a noodle doodled on one page. */
export function OpenNotebook({ className }: IllustrationProps) {
  return (
    <svg {...svgProps} className={cn("w-40", className)}>
      <ellipse cx="80" cy="108" rx="52" ry="5" className="fill-shade" stroke="none" />
      <circle cx="80" cy="60" r="44" className="fill-tomato-soft" stroke="none" />
      <path d="M80 34c-12-6-30-8-46-6v66c16-2 34 0 46 6V34Z" className="fill-cream stroke-ink" />
      <path d="M80 34c12-6 30-8 46-6v66c-16-2-34 0-46 6V34Z" className="fill-cream stroke-ink" />
      <g className="stroke-ink-ghost" strokeWidth="2">
        <path d="M44 46c9-1 19 0 27 3M44 58c9-1 19 0 27 3M44 70c9-1 19 0 27 3" />
      </g>
      <path d="M90 48c4-4 10 0 8 4s-8 4-6 9 10 2 12-3 8-4 9 1-4 9-9 10" className="stroke-semolina" strokeWidth="3" />
      <path d="M90 80c8-2 16-2 24 0" className="stroke-ink-ghost" strokeWidth="2" />
      <path d="M112 26v26l5-4 5 4V27" className="fill-tomato stroke-ink" />
    </svg>
  );
}
