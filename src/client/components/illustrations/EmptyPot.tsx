import { cn } from "@/lib/cn";
import { type IllustrationProps, svgProps } from "./index";

// Its own file: the shared illustrations load with every screen, this one only with the screens that draw it.
/** Ideas: an empty pot, steam rising, one noodle hanging over the rim. */
export function EmptyPot({ className }: IllustrationProps) {
  return (
    <svg {...svgProps} className={cn("w-40", className)}>
      <ellipse cx="80" cy="108" rx="48" ry="5" className="fill-shade" stroke="none" />
      <circle cx="80" cy="62" r="44" className="fill-semolina-soft" stroke="none" />
      <g className="stroke-ink-ghost">
        <path className="sg-steam" d="M64 40c-4-5 4-8 0-13s4-8 0-12" />
        <path className="sg-steam [animation-delay:1.1s]" d="M80 36c-4-5 4-8 0-13s4-8 0-12" />
        <path className="sg-steam [animation-delay:2.2s]" d="M96 40c-4-5 4-8 0-13s4-8 0-12" />
      </g>
      <path d="M32 60c-7 0-10 4-10 8s3 7 8 7" className="stroke-ink" />
      <path d="M128 60c7 0 10 4 10 8s-3 7-8 7" className="stroke-ink" />
      <path d="M36 56h88v30c0 9-7 16-16 16H52c-9 0-16-7-16-16V56Z" className="fill-tomato stroke-ink" />
      <rect x="30" y="50" width="100" height="10" rx="5" className="fill-tomato-strong stroke-ink" />
      <path d="M48 66v16" className="stroke-on-accent/50" />
      <path d="M108 52c2 6-3 9 0 14s-2 9 1 14c2 3 1 7-2 8" className="stroke-semolina" strokeWidth="3.5" />
    </svg>
  );
}
