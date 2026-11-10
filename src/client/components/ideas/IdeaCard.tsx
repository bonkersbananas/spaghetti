import type { Person } from "@shared/api";
import { findLinks, shortUrl } from "@shared/links";
import { relativeTime } from "@shared/time";
import { m } from "motion/react";
import { Card, PhotoCountBadge } from "@/components/ui/Card";
import { UploadBadge } from "@/components/ui/UploadBadge";
import type { ItemView } from "@/lib/items";
import { spring } from "@/lib/motion";
import { useOutbox } from "@/lib/outbox";
import { photoSrc } from "@/lib/previews";

/** What a photo shows, for screen readers: the title, else the start of the note. */
export function photoAlt(item: Pick<ItemView, "title" | "note">): string {
  const text = item.title || item.note.split("\n")[0]?.slice(0, 80);
  return text ? `Photo: ${text}` : "Photo of an idea";
}

/** Where an idea's uploads stand, summed up for its card. */
function useUploadState(item: ItemView) {
  const { retrying } = useOutbox();
  const uploading = item.photos.filter((photo) => photo.upload);
  if (!uploading.length) return item.pending && retrying ? { state: "waiting" as const, progress: 0 } : null;
  if (uploading.some((photo) => photo.upload?.status === "waiting")) return { state: "waiting" as const, progress: 0 };
  const active = uploading.find((photo) => photo.upload?.status === "uploading");
  if (!active) return { state: "processing" as const, progress: 0 };
  // Done photos count as whole ones: 2 of 3 photos at 50% shows 83%.
  const total = item.photos.length;
  const done = total - uploading.length;
  return { state: "uploading" as const, progress: (done + (active.upload?.progress ?? 0)) / total };
}

interface IdeaCardProps {
  item: ItemView;
  person?: Person;
  /** The agent it was captured through. */
  via?: string;
  /** Just captured: it lands with a little bounce. */
  landing?: boolean;
}

export function IdeaCard({ item, person, via, landing }: IdeaCardProps) {
  const cover = item.photos[0];
  const upload = useUploadState(item);
  return (
    <m.li
      layout="position"
      initial={landing ? { opacity: 0, scale: 0.9, y: -12 } : false}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={spring.gentle}
      className="list-none"
    >
      <Card
        link={{ to: "/ideas/$ideaId", params: { ideaId: item.id } }}
        aspect="portrait"
        headingLevel={2}
        photo={
          cover
            ? { id: cover.id, src: photoSrc(cover.id, "thumb"), alt: photoAlt(item), color: cover.color }
            : undefined
        }
        title={item.title}
        // Links read better short on a card: printables.com/model/123.
        note={item.note ? shortenLinks(item.note) : undefined}
        badge={item.photos.length > 1 ? <PhotoCountBadge count={item.photos.length} /> : undefined}
        chips={upload ? <UploadBadge state={upload.state} progress={upload.progress} /> : undefined}
        meta={relativeTime(item.createdAt)}
        person={person}
        via={via}
        className="h-full"
      />
    </m.li>
  );
}

function shortenLinks(text: string): string {
  let result = text;
  for (const { url } of findLinks(text).reverse()) result = result.replace(url, shortUrl(url));
  return result;
}
