import type { Person } from "@shared/api";
import { findLinks, shortUrl } from "@shared/links";
import { relativeTime } from "@shared/time";
import { m } from "motion/react";
import { lazy, Suspense } from "react";
import { Card, PhotoCountBadge } from "@/components/ui/Card";
import { UploadBadge } from "@/components/ui/UploadBadge";
import { cn } from "@/lib/cn";
import type { ItemView } from "@/lib/items";
import { spring } from "@/lib/motion";
import { useOutbox } from "@/lib/outbox";
import { photoSrc } from "@/lib/previews";

// The menu's code (popover, sheet) arrives after the first screen: it is only needed once a card is touched.
const CardMenu = lazy(() => import("./CardMenu").then((m) => ({ default: m.CardMenu })));

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

/** What the card's menu can do about the Up next queue. */
export interface UpNextMenu {
  queued: boolean;
  onToggle: () => void;
  /** Queued cards only; left out where a move isn't possible (the first can't go up). */
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}

/** Dragging a queued card to another place (desktop). */
export interface CardDrag {
  dragging: boolean;
  over: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: () => void;
  onDrop: () => void;
}

interface IdeaCardProps {
  item: ItemView;
  person?: Person;
  /** The agent it was captured through. */
  via?: string;
  /** Just captured: it lands with a little bounce. */
  landing?: boolean;
  menu?: UpNextMenu;
  drag?: CardDrag;
  /** 3 when the grid sits under a section heading (Up next). */
  headingLevel?: 2 | 3;
}

export function IdeaCard({ item, person, via, landing, menu, drag, headingLevel = 2 }: IdeaCardProps) {
  const cover = item.photos[0];
  const upload = useUploadState(item);
  return (
    <m.li
      layout="position"
      initial={landing ? { opacity: 0, scale: 0.9, y: -12 } : false}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={spring.gentle}
      className="group/idea relative list-none"
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: dragging is a mouse extra; the card's menu has Move up and Move down for keyboards and phones. */}
      <div
        draggable={!!drag}
        onDragStart={
          drag
            ? (event) => {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", item.id);
                drag.onDragStart();
              }
            : undefined
        }
        onDragEnd={drag?.onDragEnd}
        onDragOver={
          drag
            ? (event) => {
                event.preventDefault();
                drag.onDragOver();
              }
            : undefined
        }
        onDrop={
          drag
            ? (event) => {
                event.preventDefault();
                drag.onDrop();
              }
            : undefined
        }
        className={cn("h-full rounded-lg", drag?.dragging && "opacity-40", drag?.over && "ring-tomato ring-2")}
      >
        <Card
          link={{ to: "/ideas/$ideaId", params: { ideaId: item.id } }}
          aspect="portrait"
          headingLevel={headingLevel}
          reserveEnd={!!menu && !item.pending}
          photo={
            cover
              ? { id: cover.id, src: photoSrc(cover.id, "thumb"), alt: photoAlt(item), color: cover.color }
              : undefined
          }
          title={item.title || (item.draft?.status === "reading" ? "Reading the page…" : item.title)}
          // Links read better short on a card: printables.com/model/123.
          note={item.note ? shortenLinks(item.note) : undefined}
          badge={item.photos.length > 1 ? <PhotoCountBadge count={item.photos.length} /> : undefined}
          chips={upload ? <UploadBadge state={upload.state} progress={upload.progress} /> : undefined}
          meta={item.forWhom ? `for ${item.forWhom} · ${relativeTime(item.createdAt)}` : relativeTime(item.createdAt)}
          person={person}
          via={via}
          className="h-full"
        />
      </div>
      {menu && !item.pending && (
        <CardMenu menu={menu} name={item.title || item.note.split("\n")[0]?.slice(0, 40) || "this idea"} />
      )}
    </m.li>
  );
}

function shortenLinks(text: string): string {
  let result = text;
  for (const { url } of findLinks(text).reverse()) result = result.replace(url, shortUrl(url));
  return result;
}
