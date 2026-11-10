import type { Person } from "@shared/api";
import { inlineTime, relativeTime } from "@shared/time";
import { Link } from "@tanstack/react-router";
import { m } from "motion/react";
import { photoAlt } from "@/components/ideas/IdeaCard";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { BuildsIcon } from "@/components/ui/icons";
import { MetaList } from "@/components/ui/MetaList";
import { Photo } from "@/components/ui/Photo";
import { heroPhoto, newestPhoto } from "@/lib/builds";
import { cn } from "@/lib/cn";
import type { ItemView } from "@/lib/items";
import { spring } from "@/lib/motion";
import { photoSrc } from "@/lib/previews";
import { OutcomeChip } from "./Outcome";

/** When anything last happened on a build: its newest attempt, or when it started. */
export function lastActivity(item: ItemView): number {
  const last = item.attempts.at(-1);
  return Math.max(last?.printedAt ?? 0, last?.finishedAt ?? 0, item.startedAt ?? item.createdAt);
}

/** "Attempt 3 · 2 h ago", "Started yesterday". The time never breaks across lines. */
function activityLine(item: ItemView) {
  const last = item.attempts.at(-1);
  if (!last) {
    return (
      <>
        Started <span className="whitespace-nowrap">{inlineTime(item.startedAt ?? item.createdAt)}</span>
      </>
    );
  }
  return (
    <MetaList>
      <span className="whitespace-nowrap">Attempt {last.number}</span>
      <span className="whitespace-nowrap">{relativeTime(last.finishedAt ?? last.printedAt)}</span>
    </MetaList>
  );
}

/**
 * A build in progress: its newest photo first (what came off the bed last),
 * how the last attempt went over it, and when.
 */
export function BuildCard({ item, person }: { item: ItemView; person?: Person }) {
  const photo = newestPhoto(item);
  const last = item.attempts.at(-1);
  return (
    <m.li layout="position" transition={spring.gentle} className="list-none">
      <Card
        link={{ to: "/builds/$buildId", params: { buildId: item.id } }}
        aspect="portrait"
        photo={photo ? { src: photoSrc(photo.id, "thumb"), alt: photoAlt(item), color: photo.color } : undefined}
        title={item.title}
        note={item.note || undefined}
        chips={
          last ? (
            <OutcomeChip outcome={last.outcome} className="shadow-soft" />
          ) : (
            <Chip className="bg-veil text-on-veil backdrop-blur-md">Not printed yet</Chip>
          )
        }
        meta={activityLine(item)}
        person={person}
        className="h-full"
      />
    </m.li>
  );
}

/**
 * A done or shelved build, quieter than the work in progress: a small
 * photo, the title and how it ended.
 */
export function BuildRow({ item }: { item: ItemView }) {
  const photo = heroPhoto(item);
  const ended = item.finishedAt ?? item.updatedAt;
  const attempts = item.attempts.length;
  const title = item.title || item.note.split("\n")[0] || "Untitled build";
  return (
    <li className="list-none">
      <Link
        to="/builds/$buildId"
        params={{ buildId: item.id }}
        className="pressable focus-ring hover:bg-ink/4 flex items-center gap-3.5 rounded-lg p-2"
      >
        {photo ? (
          <Photo
            src={photoSrc(photo.id, "thumb")}
            alt=""
            color={photo.color || undefined}
            className={cn("size-16 shrink-0 rounded-md", item.stage === "shelved" && "opacity-75 saturate-50")}
          />
        ) : (
          <span className="bg-well text-ink-ghost flex size-16 shrink-0 items-center justify-center rounded-md">
            <BuildsIcon size={24} aria-hidden />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "text-body block truncate font-semibold",
              item.stage === "shelved" ? "text-ink-soft" : "text-ink",
            )}
          >
            {title}
          </span>
          <span className="text-small text-ink-faint block truncate">
            {item.stage === "done" ? "Done" : "Shelved"} {inlineTime(ended)}
            {attempts > 0 && ` · ${attempts} ${attempts === 1 ? "attempt" : "attempts"}`}
          </span>
        </span>
      </Link>
    </li>
  );
}
