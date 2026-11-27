import { relativeTime } from "@shared/time";
import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { NextIcon, PreviousIcon } from "@/components/ui/icons";
import { MiniCard, type MiniDrag } from "@/components/ui/MiniCard";
import { Reflow } from "@/components/ui/Reflow";
import { cn } from "@/lib/cn";
import { itemName } from "@/lib/item-name";
import type { ItemView } from "@/lib/items";
import { fileThumbSrc, photoSrc } from "@/lib/previews";
import { unreadQuery } from "@/lib/unread-comments";
import { useIsDesktop } from "@/lib/use-media-query";
import { cardName, photoAlt, plateAlt, plateCover, shortenLinks, type UpNextMenu } from "./IdeaCard";

const CardMenu = lazy(() => import("./CardMenu").then((m) => ({ default: m.CardMenu })));

interface UpNextStripProps {
  queue: ItemView[];
  /** Each idea's menu (take off, move, wishlist, add to a build). */
  menuFor: (item: ItemView, index: number) => UpNextMenu;
  landed?: (item: ItemView) => boolean;
  /** Dragging a card to another place (desktop); left out where the queue can't be reordered by hand. */
  dragFor?: (item: ItemView) => MiniDrag | undefined;
}

/**
 * Up next: one row of small cards in queue order that scrolls sideways with snap, so the queue stays one tap (or
 * click) away without taking the top of the screen. On a phone each card is one line (MiniCard `slim`). The cards show only the cover (no photo swiping), so a sideways
 * drag always scrolls the strip; each card's "…" holds the same menu as a full card (on desktop it shows on hover
 * or focus). Past the edge, the next card peeks out; on desktop two arrows scroll it for a mouse without a sideways wheel.
 */
export function UpNextStrip({ queue, menuFor, landed, dragFor }: UpNextStripProps) {
  const unread = useQuery(unreadQuery).data?.threads;
  // On a phone each card is one slim line, so the strip doesn't push the inbox's first photo down the screen.
  const slim = !useIsDesktop();
  const scroller = useRef<HTMLUListElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });
  // Whether the strip sits at its start, as it opens: read on scroll, never by a layout of its own.
  const atStart = useRef(true);
  const measure = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    atStart.current = el.scrollLeft <= 4;
    setEdges({ start: el.scrollLeft > 4, end: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: measure again when cards come or go.
  useEffect(() => {
    // Reading the strip's width forces a layout, and the state it sets another render: do it a frame after the first
    // paint, not inside the tap that opened the screen. The edges only decide which arrows and fades show.
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(measure);
    });
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
      window.removeEventListener("resize", measure);
    };
  }, [measure, queue.length]);
  // A new queue order (the server's answer after the cached one, the other person moving a card) makes scroll snap
  // follow the card it had snapped to, wherever it went: from the start, that can open the strip on its end. A strip
  // that was at its start stays there; one scrolled by hand keeps following its card.
  const order = queue.map((item) => item.id).join();
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the order changes.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && atStart.current && el.scrollLeft !== 0) el.scrollLeft = 0;
  }, [order]);
  const page = (by: 1 | -1) =>
    scroller.current?.scrollBy({ left: by * scroller.current.clientWidth * 0.8, behavior: "smooth" });
  const arrow =
    "pressable focus-ring bg-veil text-on-veil absolute top-[3.75rem] md:top-20 z-10 hidden size-9 items-center justify-center rounded-full backdrop-blur-md md:flex";
  return (
    <div className="relative">
      <ul
        ref={scroller}
        onScroll={measure}
        data-picks
        data-strip
        aria-label="Up next"
        // A sideways swipe stays in the strip: it never pulls the page, or goes back in the browser's history.
        className="no-scrollbar relative -mx-5 -my-2 flex snap-x snap-proximity scroll-px-5 gap-3 overflow-x-auto overscroll-x-contain px-5 py-2 md:mx-0 md:scroll-px-0 md:gap-5 md:px-0"
      >
        <Reflow>
          {queue.map((item, index) => {
            const cover = item.photos[0];
            const plate = cover ? undefined : plateCover(item);
            const name = itemName(item).text;
            return (
              <MiniCard
                key={item.id}
                id={item.id}
                gridScale
                slim={slim}
                unread={unread?.some((thread) => thread.itemId === item.id)}
                landing={landed?.(item)}
                drag={dragFor?.(item)}
                link={{ to: "/ideas/$ideaId", params: { ideaId: item.id } }}
                photo={
                  cover
                    ? { src: photoSrc(cover.id, "thumb"), alt: photoAlt(item), color: cover.color }
                    : plate
                      ? { src: fileThumbSrc(plate), alt: plateAlt(item), fit: "contain" }
                      : undefined
                }
                note={item.note ? shortenLinks(item.note) : undefined}
                {...cardName(item, !cover && !plate)}
                meta={relativeTime(item.createdAt)}
                corner={
                  item.pending ? undefined : (
                    <Suspense fallback={null}>
                      <CardMenu compact={!slim} slim={slim} menu={menuFor(item, index)} item={item} name={name} />
                    </Suspense>
                  )
                }
              />
            );
          })}
        </Reflow>
      </ul>
      {edges.start && (
        <button type="button" aria-label="Earlier in Up next" onClick={() => page(-1)} className={cn(arrow, "-left-4")}>
          <PreviousIcon size={18} weight="bold" aria-hidden />
        </button>
      )}
      {edges.end && (
        <button type="button" aria-label="Later in Up next" onClick={() => page(1)} className={cn(arrow, "-right-4")}>
          <NextIcon size={18} weight="bold" aria-hidden />
        </button>
      )}
    </div>
  );
}
