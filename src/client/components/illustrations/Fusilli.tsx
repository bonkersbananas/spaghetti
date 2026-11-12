import { cn } from "@/lib/cn";
import { type IllustrationProps, svgProps } from "./index";

// Its own file: the shared illustrations load with every screen, this one only with Twists.
/** Twists: a corkscrew of fusilli beside a plain tube of penne, the same dough shaped another way. */
export function Fusilli({ className }: IllustrationProps) {
  return (
    <svg {...svgProps} className={cn("w-40", className)}>
      <ellipse cx="80" cy="108" rx="52" ry="5" className="fill-shade" stroke="none" />
      <circle cx="80" cy="60" r="44" className="fill-semolina-soft" stroke="none" />
      <rect
        x="30"
        y="58"
        width="30"
        height="44"
        rx="12"
        className="fill-cream stroke-ink"
        transform="rotate(-14 45 80)"
      />
      <path d="M34 72l24-8M32 84l26-8M36 96l22-8" className="stroke-ink-ghost" />
      <path
        d="M92 30c18 4 26 10 8 16-18 5-26 11-8 16 18 5 26 11 8 16-18 5-26 11-8 16-14 4-22-1-20-7"
        className="stroke-ink"
        strokeWidth="14"
        fill="none"
      />
      <path
        d="M92 30c18 4 26 10 8 16-18 5-26 11-8 16 18 5 26 11 8 16-18 5-26 11-8 16-14 4-22-1-20-7"
        className="stroke-semolina"
        strokeWidth="10"
        fill="none"
      />
      <path d="M96 38c10 3 14 6 6 9M96 62c10 3 14 6 6 9" className="stroke-cream" strokeWidth="2" />
    </svg>
  );
}
