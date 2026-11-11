import { cn } from "@/lib/cn";
import { type IllustrationProps, svgProps } from "./index";

// Its own file: the shared illustrations load with every screen, this one only with the shopping list.
/** The shopping list: a market basket with a spool and a bottle of glue in it, one noodle hanging over the edge. */
export function EmptyBasket({ className }: IllustrationProps) {
  return (
    <svg {...svgProps} className={cn("w-40", className)}>
      <ellipse cx="80" cy="108" rx="48" ry="5" className="fill-shade" stroke="none" />
      <circle cx="80" cy="60" r="44" className="fill-basil-soft" stroke="none" />
      <path d="M52 58c0-30 56-30 56 0" className="stroke-ink" />
      <rect x="88" y="30" width="16" height="30" rx="5" className="fill-cream stroke-ink" />
      <rect x="92" y="21" width="8" height="10" rx="2" className="fill-tomato stroke-ink" />
      <path d="M92 42h8" className="stroke-ink-ghost" />
      <circle cx="68" cy="50" r="15" className="fill-basil stroke-ink" />
      <path d="M58 46c4-6 14-8 20-2" className="stroke-on-accent/40" />
      <circle cx="68" cy="50" r="5" className="fill-paper-deep stroke-ink" />
      <path d="M38 62h84l-8 36c-1 5-5 8-10 8H56c-5 0-9-3-10-8l-8-36Z" className="fill-semolina stroke-ink" />
      <rect x="33" y="56" width="94" height="10" rx="5" className="fill-cream stroke-ink" />
      <path d="M60 72l3 28M80 72v28M100 72l-3 28M46 86h68" className="stroke-ink/25" />
      <path d="M118 60c4 5-2 9 2 14s-1 9 2 13" className="stroke-semolina" strokeWidth="3.5" />
    </svg>
  );
}
