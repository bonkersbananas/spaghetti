import { lazy, Suspense } from "react";
import { MiniCard } from "@/components/ui/MiniCard";
import { Reflow } from "@/components/ui/Reflow";
import type { ItemView } from "@/lib/items";
import { fileThumbSrc, photoSrc } from "@/lib/previews";
import { photoAlt, plateAlt, plateCover, type UpNextMenu } from "./IdeaCard";

const CardMenu = lazy(() => import("./CardMenu").then((m) => ({ default: m.CardMenu })));

interface UpNextStripProps {
  queue: ItemView[];
  /** Each idea's menu (take off, move, wishlist, add to a build). */
  menuFor: (item: ItemView, index: number) => UpNextMenu;
  landed?: (item: ItemView) => boolean;
}

/**
 * Up next on phones: one row of small cards in queue order that scrolls sideways with snap, so the queue stays one
 * tap away without taking the top of the screen. The cards show only the cover (no photo swiping), so a sideways
 * drag always scrolls the strip; each card's "…" holds the same menu as a full card.
 */
export function UpNextStrip({ queue, menuFor, landed }: UpNextStripProps) {
  return (
    <ul
      data-picks
      data-strip
      aria-label="Up next"
      // A sideways swipe stays in the strip: it never pulls the page, or goes back in the browser's history.
      className="no-scrollbar relative -mx-5 flex snap-x snap-proximity scroll-px-5 items-start gap-2.5 overflow-x-auto overscroll-x-contain px-5 pb-1"
    >
      <Reflow>
        {queue.map((item, index) => {
          const cover = item.photos[0];
          const plate = cover ? undefined : plateCover(item);
          const name = item.title || item.note.split("\n")[0]?.slice(0, 120) || "this idea";
          return (
            <MiniCard
              key={item.id}
              landing={landed?.(item)}
              link={{ to: "/ideas/$ideaId", params: { ideaId: item.id } }}
              photo={
                cover
                  ? { src: photoSrc(cover.id, "thumb"), alt: photoAlt(item), color: cover.color }
                  : plate
                    ? { src: fileThumbSrc(plate), alt: plateAlt(item), fit: "contain" }
                    : undefined
              }
              note={item.note || undefined}
              title={item.title || undefined}
              corner={
                item.pending ? undefined : (
                  <Suspense fallback={null}>
                    <CardMenu compact menu={menuFor(item, index)} item={item} name={name} />
                  </Suspense>
                )
              }
            />
          );
        })}
      </Reflow>
    </ul>
  );
}
