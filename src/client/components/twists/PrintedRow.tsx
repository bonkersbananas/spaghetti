import { relativeTime } from "@shared/time";
import { Link } from "@tanstack/react-router";
import { OutcomeChip } from "@/components/builds/Outcome";
import { NoteFace } from "@/components/ui/NoteFace";
import { Photo } from "@/components/ui/Photo";
import { newestPhoto } from "@/lib/builds";
import type { ItemView } from "@/lib/items";
import { photoSrc } from "@/lib/previews";

/** What a picture needs: an id to fetch and a colour to hold its place. */
interface PhotoShape {
  id: string;
  color: string;
}

/** A build that printed a twist, as a quiet row: its picture if it has one, its title, how it went and when. */
export function PrintedRow({ build, fallback }: { build: ItemView; fallback?: PhotoShape | null }) {
  // Its newest picture (an attempt's, else its own), else the twist's, else its words on an index card: never a blank square.
  const photo = newestPhoto(build) ?? fallback ?? undefined;
  const last = build.attempts.at(-1);
  const when = relativeTime(last?.finishedAt ?? last?.printedAt ?? build.startedAt ?? build.createdAt);
  return (
    <li>
      <Link
        to="/builds/$buildId"
        params={{ buildId: build.id }}
        className="pressable focus-ring bg-cream shadow-soft hover:shadow-raised flex items-center gap-3 rounded-lg p-2"
      >
        {photo ? (
          <Photo
            src={photoSrc(photo.id, "thumb")}
            alt=""
            color={photo.color || undefined}
            className="size-14 shrink-0 rounded-md"
          />
        ) : (
          <span className="bg-note relative size-14 shrink-0 overflow-hidden rounded-md" aria-hidden>
            <NoteFace note={build.note.trim() || build.title?.trim() || "Untitled build"} compact />
          </span>
        )}
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-body text-ink truncate font-semibold">{build.title?.trim() || "Untitled build"}</span>
          <span className="flex items-center gap-2">
            {last ? <OutcomeChip outcome={last.outcome} /> : null}
            <span className="text-small text-ink-faint">{last ? when : `Started ${when}`}</span>
          </span>
        </span>
      </Link>
    </li>
  );
}
