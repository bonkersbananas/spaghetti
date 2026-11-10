import type { MadeBuild } from "@shared/insights";
import { Link } from "@tanstack/react-router";
import { Photo } from "@/components/ui/Photo";
import { photoSrc } from "@/lib/previews";

/** How many of the year's finished prints the mosaic shows. */
export const MOSAIC_SHOWN = 12;

interface MosaicProps {
  builds: MadeBuild[];
  /** How many finished prints there are in all, shown ones included. */
  total: number;
}

/**
 * What got made this year: the final photo of each finished build, newest
 * first, as square thumbnails that open their build. A tight grid on phones,
 * larger on the desk; the rest are counted, not listed.
 */
export function Mosaic({ builds, total }: MosaicProps) {
  const shown = builds.slice(0, MOSAIC_SHOWN);
  const more = total - shown.length;
  return (
    <div className="flex flex-col gap-3">
      <ul className="m-0 grid list-none grid-cols-4 gap-1.5 p-0 md:grid-cols-3 md:gap-2.5">
        {shown.map((build) => (
          <li key={build.itemId} className="min-w-0">
            <Link
              to="/builds/$buildId"
              params={{ buildId: build.itemId }}
              className="pressable focus-ring block overflow-hidden rounded-md md:rounded-lg"
            >
              <Photo
                src={photoSrc(build.photo.id, "thumb")}
                alt={build.title?.trim() || "A finished print"}
                color={build.photo.color}
                className="aspect-square w-full"
              />
            </Link>
          </li>
        ))}
      </ul>
      {more > 0 && (
        <Link
          to="/journal"
          search={{ outcome: "success" }}
          className="text-small text-ink-soft hover:text-ink focus-ring w-fit rounded-sm"
        >
          and {more} more
        </Link>
      )}
    </div>
  );
}
