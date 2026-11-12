import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Photo } from "./Photo";

interface PickRowProps {
  /** The leading picture (its thumbnail and color), or none: a quiet tile holds the place. */
  photo?: { src: string; color?: string } | null;
  title: string;
  /** A quiet second line. */
  meta?: ReactNode;
  /** A small mark at the end: "On the bed", "Latest". */
  mark?: ReactNode;
  onSelect: () => void;
  /** Starts with focus (the suggested choice), so Enter takes it. */
  autoFocus?: boolean;
  className?: string;
}

/**
 * One choice in a list of things to pick from, picture first: a tap takes it. Builds in "Add to a build", attempts in
 * the second step. 56 px tall (a thumb's row), a faint wash on hover.
 */
export function PickRow({ photo, title, meta, mark, onSelect, autoFocus, className }: PickRowProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      // biome-ignore lint/a11y/noAutofocus: the suggested row takes Enter in a sheet that was just opened to choose.
      autoFocus={autoFocus}
      className={cn(
        "pressable focus-ring duration-fast hover:bg-ink/4 -mx-2 flex min-h-14 w-[calc(100%+1rem)] items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors",
        className,
      )}
    >
      {photo ? (
        <Photo src={photo.src} alt="" color={photo.color} className="size-10 shrink-0 rounded-md md:size-11" />
      ) : (
        <span aria-hidden className="bg-well size-10 shrink-0 rounded-md md:size-11" />
      )}
      <span className="min-w-0 flex-1">
        <span className="text-body text-ink block truncate font-semibold">{title}</span>
        {meta && <span className="text-small text-ink-faint block truncate">{meta}</span>}
      </span>
      {mark && <span className="text-caption text-ink-soft shrink-0 font-semibold">{mark}</span>}
    </button>
  );
}
