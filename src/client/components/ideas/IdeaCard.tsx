import type { Person } from "@shared/api";
import { findLinks, shortUrl } from "@shared/links";
import { relativeTime } from "@shared/time";
import { m } from "motion/react";
import { Card, PhotoCountBadge } from "@/components/ui/Card";
import { MoreIcon, MoveDownIcon, MoveUpIcon, UpNextIcon } from "@/components/ui/icons";
import { Popover, PopoverClose } from "@/components/ui/Popover";
import { UploadBadge } from "@/components/ui/UploadBadge";
import { cn } from "@/lib/cn";
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

/** The card's "…" button: Up next, and where it stands in the queue. A link can't hold a button, so it sits over the card. */
function CardMenu({ menu, name }: { menu: UpNextMenu; name: string }) {
  const item =
    "text-body text-ink hover:bg-ink/5 focus-visible:bg-ink/5 flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-left outline-none";
  return (
    <Popover
      label={`Up next options for ${name}`}
      side="bottom"
      align="start"
      className="w-56 p-1.5"
      trigger={
        <button
          type="button"
          aria-label={`Options for ${name}`}
          className="pressable focus-ring touch-target bg-veil text-on-veil hover:bg-veil-strong absolute top-3 left-3 flex size-8 items-center justify-center rounded-full backdrop-blur-md transition-opacity md:opacity-0 md:group-focus-within/idea:opacity-100 md:group-hover/idea:opacity-100"
        >
          <MoreIcon size={18} weight="bold" aria-hidden />
        </button>
      }
    >
      <div className="flex flex-col">
        <PopoverClose asChild>
          <button type="button" className={item} onClick={menu.onToggle}>
            <UpNextIcon size={20} aria-hidden />
            {menu.queued ? "Take off Up next" : "Up next"}
          </button>
        </PopoverClose>
        {menu.onMoveUp && (
          <PopoverClose asChild>
            <button type="button" className={item} onClick={menu.onMoveUp}>
              <MoveUpIcon size={20} aria-hidden />
              Move up
            </button>
          </PopoverClose>
        )}
        {menu.onMoveDown && (
          <PopoverClose asChild>
            <button type="button" className={item} onClick={menu.onMoveDown}>
              <MoveDownIcon size={20} aria-hidden />
              Move down
            </button>
          </PopoverClose>
        )}
      </div>
    </Popover>
  );
}

function shortenLinks(text: string): string {
  let result = text;
  for (const { url } of findLinks(text).reverse()) result = result.replace(url, shortUrl(url));
  return result;
}
