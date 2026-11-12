import { Link, type LinkProps } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { NextIcon } from "./icons";

interface HubTileProps {
  to: LinkProps["to"];
  title: string;
  /** One short line on what is in there now ("14 spools · 2 running low"); null while it loads. */
  summary: ReactNode;
  /** The tile's picture: a few spools, a few thumbnails. Decorative; the title says what the tile is. */
  visual: ReactNode;
  className?: string;
}

/**
 * A big way into a place that has no tab of its own (the Workshop's Pantry, Printer and Shopping list): the
 * place's contents drawn as a small picture band, its name in Fraunces and one line on how things stand. A whole
 * surface to tap with a thumb; use it for a handful of destinations, not for lists (rows are for those).
 */
export function HubTile({ to, title, summary, visual, className }: HubTileProps) {
  return (
    <Link
      to={to}
      className={cn(
        "pressable focus-ring bg-cream shadow-soft hover:shadow-raised duration-fast flex flex-col rounded-lg p-1.5 transition-shadow",
        className,
      )}
    >
      <span className="bg-ink/4 flex h-28 items-center overflow-hidden rounded-md px-5" aria-hidden>
        {visual}
      </span>
      <span className="flex items-center gap-3 px-3 pt-3 pb-2.5">
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-title text-ink font-display font-semibold">{title}</span>
          <span className="text-small text-ink-faint min-h-[1.5em] truncate">{summary}</span>
        </span>
        <NextIcon size={18} className="text-ink-faint shrink-0" aria-hidden />
      </span>
    </Link>
  );
}
