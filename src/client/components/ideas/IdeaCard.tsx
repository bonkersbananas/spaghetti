import type { AttemptFile, Person } from "@shared/api";
import { findLinks, shortUrl } from "@shared/links";
import { modelOf } from "@shared/model-mark";
import { relativeTime } from "@shared/time";
import { m } from "motion/react";
import { lazy, type Ref, Suspense, useState } from "react";
import { Card } from "@/components/ui/Card";
import { ModelMark } from "@/components/ui/ModelMark";
import { ReactionGlance } from "@/components/ui/ReactionGlance";
import { useReflow } from "@/components/ui/Reflow";
import { UploadBadge } from "@/components/ui/UploadBadge";
import { cn } from "@/lib/cn";
import type { ItemView } from "@/lib/items";
import { useOutbox } from "@/lib/outbox";
import { fileThumbSrc, hasPreview, photoSrc } from "@/lib/previews";
import { useUnreadCount } from "@/lib/unread-comments";

// The menu's code (popover, sheet) arrives after the first screen: it is only needed once a card is touched.
const CardMenu = lazy(() => import("./CardMenu").then((m) => ({ default: m.CardMenu })));

/** What a photo shows, for screen readers: the title, else the start of the note. */
export function photoAlt(item: Pick<ItemView, "title" | "note">): string {
  const text = item.title || item.note.split("\n")[0]?.slice(0, 80);
  return text ? `Photo: ${text}` : "Photo of an idea";
}

/**
 * The newest of an idea's files with a plate picture (a slicer's file, or a model Spaghetti sliced): the idea's cover
 * while it has no photo of its own. A photo always wins. A model being sliced here has its picture on this device
 * before the server does.
 */
export function plateCover(item: Pick<ItemView, "files">): AttemptFile | undefined {
  let newest: AttemptFile | undefined;
  for (const file of item.files ?? []) {
    if ((file.hasThumb || hasPreview(file.id)) && (!newest || file.createdAt >= newest.createdAt)) newest = file;
  }
  return newest;
}

/** What a plate picture shows, for screen readers. */
export function plateAlt(item: Pick<ItemView, "title" | "note">): string {
  const text = item.title || item.note.split("\n")[0]?.slice(0, 80);
  return text ? `Slicer preview: ${text}` : "Slicer preview of an idea";
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
  /** Offer "Add to your wishlist" for this idea; the menu (loaded on demand) reads and changes your list itself. */
  wish?: Pick<ItemView, "id" | "pending">;
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
  /** Up next on desktop: a wider, squarer card, so the queue reads as the featured row. */
  featured?: boolean;
  /** Lets the list measure the card when it leaves (see Reflow). */
  ref?: Ref<HTMLLIElement>;
}

export function IdeaCard({ item, person, via, landing, menu, drag, headingLevel = 2, featured, ref }: IdeaCardProps) {
  const cover = item.photos[0];
  const plate = cover ? undefined : plateCover(item);
  const upload = useUploadState(item);
  const unread = useUnreadCount(item.id);
  const model = modelOf(item);
  // The photo swiped to: the idea's page opens on it.
  const [showing, setShowing] = useState<string>();
  const opensOn =
    showing && showing !== cover?.id && item.photos.some((photo) => photo.id === showing) ? showing : undefined;
  return (
    <m.li {...useReflow(landing)} ref={ref} className="group/idea relative list-none">
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
          link={{ to: "/ideas/$ideaId", params: { ideaId: item.id }, search: opensOn ? { photo: opensOn } : {} }}
          aspect={featured ? "square" : "portrait"}
          headingLevel={headingLevel}
          reserveEnd={!!menu && !item.pending}
          photo={
            cover
              ? { id: cover.id, src: photoSrc(cover.id, "thumb"), alt: photoAlt(item), color: cover.color }
              : plate
                ? { src: fileThumbSrc(plate.id), alt: plateAlt(item), fit: "contain" }
                : undefined
          }
          title={item.title || (item.draft?.status === "reading" ? "Reading the page…" : item.title)}
          // Links read better short on a card: printables.com/model/123.
          note={item.note ? shortenLinks(item.note) : undefined}
          unread={unread}
          photos={
            item.photos.length > 1
              ? item.photos.map((photo) => ({
                  id: photo.id,
                  src: photoSrc(photo.id, "thumb"),
                  alt: photoAlt(item),
                  color: photo.color,
                }))
              : undefined
          }
          onPhotoChange={(index) => setShowing(item.photos[index]?.id)}
          chips={upload ? <UploadBadge state={upload.state} progress={upload.progress} /> : undefined}
          mark={model ? <ModelMark mark={model} /> : undefined}
          sub={item.forWhom ? `for ${item.forWhom}` : undefined}
          reactions={<ReactionGlance reactions={item.reactions} />}
          meta={relativeTime(item.createdAt)}
          person={person}
          via={via}
          className="h-full"
        />
      </div>
      {menu && !item.pending && (
        // Its own boundary: the menu's code must never hold the whole list back (the page waited for it, 300 ms, on every first visit).
        <Suspense fallback={null}>
          <CardMenu
            menu={menu}
            item={item}
            name={item.title || item.note.split("\n")[0]?.slice(0, 120) || "this idea"}
          />
        </Suspense>
      )}
    </m.li>
  );
}

function shortenLinks(text: string): string {
  let result = text;
  for (const { url } of findLinks(text).reverse()) result = result.replace(url, shortUrl(url));
  return result;
}
