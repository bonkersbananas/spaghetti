import { Link } from "@tanstack/react-router";
import { NextIcon, SparkleIcon } from "@/components/ui/icons";
import { Photo } from "@/components/ui/Photo";
import { scoutHeading, scoutPictureUrl, useScout, waitingPicks } from "@/lib/scout";

/**
 * The idea scout's picks on a phone, as one row: their pictures fanned out and "Three for you this week", leading
 * to the week's page where they can be kept or put away. Drawn only while some wait; the full cards stay on Today
 * (desktop) and on the week page. Lazy, like ScoutSection.
 */
export default function ScoutRow() {
  const round = useScout();
  const waiting = waitingPicks(round);
  if (!round || waiting.length === 0) return null;
  return (
    <Link
      to="/week/$monday"
      params={{ monday: round.monday }}
      className="pressable focus-ring bg-cream shadow-soft flex items-center gap-3.5 rounded-lg py-2.5 pr-3 pl-2.5"
    >
      <span className="flex shrink-0 pl-2" aria-hidden>
        {waiting.slice(0, 3).map((pick) => {
          const src = scoutPictureUrl(pick);
          return (
            <span key={pick.id} className="ring-cream bg-well -ml-2 size-10 overflow-hidden rounded-md ring-2">
              {src ? (
                <Photo src={src} alt="" className="size-full" />
              ) : (
                <SparkleIcon size={18} className="text-ink-faint m-3" />
              )}
            </span>
          );
        })}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-body text-ink font-semibold">{scoutHeading(waiting.length)}</span>
        <span className="text-small text-ink-faint truncate">Picked by Claude from your wishlists</span>
      </span>
      <NextIcon size={18} className="text-ink-faint shrink-0" aria-hidden />
    </Link>
  );
}
