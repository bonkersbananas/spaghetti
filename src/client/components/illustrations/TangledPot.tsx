import { cn } from "@/lib/cn";
import { type IllustrationProps, svgProps } from "./index";

// Its own file: only the error screen loads it.
/** The error screen: a pot with the noodles gone over the rim in a tangle. */
export function TangledPot({ className }: IllustrationProps) {
  return (
    <svg {...svgProps} className={cn("w-40", className)}>
      <ellipse cx="80" cy="108" rx="48" ry="5" className="fill-shade" stroke="none" />
      <circle cx="80" cy="62" r="44" className="fill-tomato-soft" stroke="none" />
      <path d="M38 60h84l-6 36c-1 6-6 10-12 10H56c-6 0-11-4-12-10l-6-36Z" className="fill-cream stroke-ink" />
      <rect x="34" y="54" width="92" height="10" rx="5" className="fill-paper-deep stroke-ink" />
      <path d="M52 54c-4-16 14-26 24-14s-12 20-4 8 26-18 30-2-18 6-12 8" className="stroke-semolina" strokeWidth="4" />
      <path d="M104 62c6 8 2 16 8 22" className="stroke-semolina" strokeWidth="4" />
      <path d="M62 78h4M92 78h4" className="stroke-ink" />
      <path d="M72 88c4-3 10-3 14 0" className="stroke-ink" />
    </svg>
  );
}
