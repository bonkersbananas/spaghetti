import { cn } from "@/lib/cn";
import { type IllustrationProps, svgProps } from "./index";

// Its own file: the shared illustrations load with every screen, this one only with the screens that draw it.
/** A private list: the pot with its lid on and nothing showing. */
export function ClosedPot({ className }: IllustrationProps) {
  return (
    <svg {...svgProps} className={cn("w-40", className)}>
      <ellipse cx="80" cy="108" rx="48" ry="5" className="fill-shade" stroke="none" />
      <circle cx="80" cy="62" r="44" className="fill-semolina-soft" stroke="none" />
      <path d="M32 66c-7 0-10 4-10 8s3 7 8 7" className="stroke-ink" />
      <path d="M128 66c7 0 10 4 10 8s-3 7-8 7" className="stroke-ink" />
      <path d="M36 62h88v24c0 9-7 16-16 16H52c-9 0-16-7-16-16V62Z" className="fill-tomato stroke-ink" />
      <path d="M48 72v14" className="stroke-on-accent/50" />
      <path d="M34 62c0-12 20-18 46-18s46 6 46 18Z" className="fill-tomato-strong stroke-ink" />
      <circle cx="80" cy="40" r="5" className="fill-cream stroke-ink" />
    </svg>
  );
}
