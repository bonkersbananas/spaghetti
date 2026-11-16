import type { AttemptFile, Person } from "@shared/api";
import { findLinks, shortUrl } from "@shared/links";
import { cleanModelUrl, modelOf } from "@shared/model-mark";
import { relativeTime } from "@shared/time";
import { m } from "motion/react";
import { lazy, type Ref, Suspense, useState } from "react";
import { Card, coverPhoto } from "@/components/ui/Card";
import { ForLine } from "@/components/ui/ForField";
import { ModelMark } from "@/components/ui/ModelMark";
import { ReactionGlance } from "@/components/ui/ReactionGlance";
import { useReflow } from "@/components/ui/Reflow";
import { NamingSign } from "@/components/ui/Skeleton";
import { UploadBadge } from "@/components/ui/UploadBadge";
import { cn } from "@/lib/cn";
import { useForLine } from "@/lib/for-whom";
import { useNaming } from "@/lib/item-name";
import type { ItemView } from "@/lib/items";
import { useOutbox } from "@/lib/outbox";
import { coverOf, newestPlate, photoAlt, photoSrc, plateAlt } from "@/lib/previews";

// Where they used to live: the idea page and Up next read them from here.
// The styleguide shows the mark from here, so it stays in the idea card's chunk (its only other user) rather than a
// chunk of its own on every Ideas first load.
export { ModelMark, photoAlt, plateAlt };

import { useUnreadCount, useUnreadThreadSearch } from "@/lib/unread-comments";

// The menu's code (popover, sheet) arrives after the first screen: it is only needed once a card is touched.
const CardMenu = lazy(() => import("./CardMenu").then((m) => ({ default: m.CardMenu })));

/**
 * The newest of an idea's files with a plate picture (a slicer's file, or a model Spaghetti sliced): the idea's cover
 * while it has no photo of its own (`coverOf` in lib/previews.ts, the rule every cover follows). A photo always wins.
 */
export function plateCover(item: Pick<ItemView, "files">): AttemptFile | undefined {
  return newestPlate({ files: item.files, attempts: [] });
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

interface IdeaCardProps {
  item: ItemView;
  person?: Person;
  /** The agent it was captured through. */
  via?: string;
  /** Just captured: it lands with a little bounce. */
  landing?: boolean;
  menu?: UpNextMenu;
  /** 3 when the grid sits under a section heading (Up next). */
  headingLevel?: 2 | 3;
  /** Lets the list measure the card when it leaves (see Reflow). */
  ref?: Ref<HTMLLIElement>;
}

export function IdeaCard({ item, person, via, landing, menu, headingLevel = 2, ref }: IdeaCardProps) {
  // Its cover by the one rule (lib/previews.ts coverOf): the first photo, else the newest plate picture, else the note.
  const cover = coverOf(item);
  const upload = useUploadState(item);
  const unread = useUnreadCount(item.id);
  const forLine = useForLine();
  const toThread = useUnreadThreadSearch(item.id);
  const model = modelOf(item);
  const naming = useNaming(item);
  // The photo swiped to: the idea's page opens on it.
  const [showing, setShowing] = useState<string>();
  const opensOn =
    showing && showing !== item.photos[0]?.id && item.photos.some((photo) => photo.id === showing)
      ? showing
      : undefined;
  return (
    <m.li {...useReflow(landing)} ref={ref} className="group/idea relative list-none">
      <div className="h-full rounded-lg">
        <Card
          link={{
            to: "/ideas/$ideaId",
            params: { ideaId: item.id },
            search: { ...(opensOn ? { photo: opensOn } : {}), ...toThread } as never,
          }}
          aspect="portrait"
          headingLevel={headingLevel}
          reserveEnd={!!menu && !item.pending}
          photo={coverPhoto(cover, cover.kind === "plate" ? plateAlt(item) : photoAlt(item))}
          title={item.title || (item.draft?.status === "reading" ? "Reading the page…" : item.title)}
          naming={naming && <NamingSign />}
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
          sub={forLine(item.forWhom) ? <ForLine text={forLine(item.forWhom) as string} /> : undefined}
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

/** Links read better short on a card: printables.com/model/123, a model page without ?from=search and the like. */
export function shortenLinks(text: string): string {
  let result = text;
  for (const { url } of findLinks(text).reverse()) result = result.replace(url, shortUrl(cleanModelUrl(url)));
  return result;
}
