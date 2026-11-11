import { cn } from "@/lib/cn";
import { type IllustrationProps, svgProps } from "./index";

// In its own module: only the wishlists page draws it, so screens that load the other illustrations (sign-in's mark) don't carry it.
/** Wishlists: a bowl of pasta with a wish rising off it like steam. */
export function WishingBowl({ className }: IllustrationProps) {
  return (
    <svg {...svgProps} className={cn("w-40", className)}>
      <ellipse cx="80" cy="108" rx="48" ry="5" className="fill-shade" stroke="none" />
      <circle cx="80" cy="62" r="44" className="fill-tomato-soft" stroke="none" />
      <g className="stroke-ink-ghost">
        <path className="sg-steam" d="M62 50c-3-4 3-6 0-10" />
        <path className="sg-steam [animation-delay:1.4s]" d="M98 50c-3-4 3-6 0-10" />
      </g>
      <path
        d="M80 13l3.8 9.7 10.5.7-8.1 6.6 2.6 10.1-8.8-5.6-8.8 5.6 2.6-10.1-8.1-6.6 10.5-.7Z"
        className="fill-semolina stroke-ink"
      />
      <path d="M104 14v6M101 17h6M56 30v4M54 32h4" className="stroke-ink-faint" strokeWidth="2" />
      <path d="M42 68c2-9 12-14 20-10 5-8 20-9 27-2 8-5 21-2 27 8" className="fill-semolina stroke-ink" />
      <path d="M58 62c4 2 6 5 6 6M78 58c3 3 4 6 4 9M98 62c2 2 3 4 3 6" className="stroke-ink/40" />
      <path d="M32 66h96c0 21-20 36-48 36S32 87 32 66Z" className="fill-cream stroke-ink" />
      <path d="M40 76c8 9 22 14 40 14s32-5 40-14" className="stroke-tomato" strokeWidth="3" />
    </svg>
  );
}
