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
        // On a phone the picture sits beside the words and is drawn smaller, so all the places fit one screen.
        "pressable focus-ring bg-cream shadow-soft hover:shadow-raised duration-fast flex rounded-lg p-1.5 transition-shadow max-md:items-center md:flex-col",
        className,
      )}
    >
      <span
        className="bg-ink/4 flex items-center justify-center overflow-hidden rounded-md px-4 max-md:h-24 max-md:w-32 max-md:shrink-0 max-md:px-0 md:h-28"
        aria-hidden
      >
        <span className="flex items-center justify-center max-md:w-[17rem] max-md:shrink-0 max-md:origin-center max-md:scale-[.45] md:w-full">
          {visual}
        </span>
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-3 px-3 md:pt-3 md:pb-2.5">
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-title text-ink font-display font-semibold">{title}</span>
          <span className="text-small text-ink-faint min-h-[1.5em] md:truncate">{summary}</span>
        </span>
        <NextIcon size={18} className="text-ink-faint shrink-0" aria-hidden />
      </span>
    </Link>
  );
}
