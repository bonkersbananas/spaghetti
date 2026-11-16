import { Children, isValidElement, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { IconButton } from "./Button";
import { NextIcon, PreviousIcon } from "./icons";
import { Reflow } from "./Reflow";
import { Section } from "./Section";

/**
 * A card's width in a `CardRow` (put it on the card's `li`): three quarters of a phone, so the next one peeks in
 * and says the row scrolls, two side by side from `md` and three from `xl`, each wider than a grid's cards.
 */
export const cardRowItem =
  "w-3/4 max-w-80 shrink-0 snap-start md:w-[calc((100%-1.25rem)/2)] md:max-w-none xl:w-[calc((100%-2.5rem)/3)]";

interface CardRowProps {
  /** The heading's id, which names the section. */
  id: string;
  /** The section's title ("Up next"); it also names the list and the arrows ("Later in Up next"). */
  title: string;
  /** How many cards it holds, after the title. */
  count?: number;
  /** The cards (`Card size="feature"` in an `li` with `cardRowItem`), in order. */
  children: ReactNode;
  className?: string;
}

/**
 * A section a page leads with: a headline and one row of large cards that scrolls sideways with snap (Ideas' Up
 * next). On a phone the next card peeks in from the edge; on desktop two quiet arrows beside the heading page
 * through more than the row shows (and J and K walk the cards, which carry `data-picks`). Its cards show only their
 * cover, no photo swiping, so a sideways drag always scrolls the row.
 */
export function CardRow({ id, title, count, children, className }: CardRowProps) {
  const scroller = useRef<HTMLUListElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });
  const measure = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    setEdges({ start: el.scrollLeft > 4, end: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: measure again when cards come or go.
  useEffect(() => {
    // Reading the row's width forces a layout, and the state it sets another render: do it a frame after the first
    // paint, not inside the tap that opened the screen. The edges only decide which arrows show.
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
  }, [measure, count]);
  // A row nobody has scrolled starts at its first card, also when the cards change under it (the saved copy drew
  // one order and the server's answer another): a snapped row would otherwise keep the card it was on in view.
  const touched = useRef(false);
  const order = Children.toArray(children)
    .map((child) => (isValidElement(child) ? child.key : ""))
    .join(" ");
  // biome-ignore lint/correctness/useExhaustiveDependencies: only when the cards or their order change.
  useEffect(() => {
    if (touched.current) return;
    const frame = requestAnimationFrame(() => {
      const el = scroller.current;
      if (el && !touched.current && el.scrollLeft > 0) el.scrollTo({ left: 0, behavior: "instant" });
    });
    return () => cancelAnimationFrame(frame);
  }, [order]);
  const touch = () => {
    touched.current = true;
  };
  const page = (by: 1 | -1) => {
    touch();
    scroller.current?.scrollBy({ left: by * scroller.current.clientWidth * 0.8, behavior: "smooth" });
  };
  const arrows =
    edges.start || edges.end ? (
      <div className="-mr-1.5 hidden gap-1 self-center md:flex">
        <IconButton
          icon={PreviousIcon}
          size="sm"
          label={`Earlier in ${title}`}
          disabled={!edges.start}
          onClick={() => page(-1)}
        />
        <IconButton
          icon={NextIcon}
          size="sm"
          label={`Later in ${title}`}
          disabled={!edges.end}
          onClick={() => page(1)}
        />
      </div>
    ) : undefined;
  return (
    <Section id={id} title={title} count={count} aside={arrows} className={className}>
      <ul
        ref={scroller}
        onScroll={measure}
        onPointerDown={touch}
        onWheel={touch}
        onFocus={touch}
        data-picks
        data-strip
        aria-label={title}
        // Edge to edge on a phone; on desktop a little room either side for the cards' shadows, which the scroller
        // would otherwise clip. A sideways swipe stays in the row: it never pulls the page, or goes back in history.
        className="no-scrollbar relative -mx-5 -my-3 flex snap-x snap-mandatory scroll-px-5 gap-3 overflow-x-auto overscroll-x-contain px-5 py-3 md:-mx-3 md:snap-proximity md:scroll-px-3 md:gap-5 md:px-3"
      >
        <Reflow>{children}</Reflow>
      </ul>
    </Section>
  );
}
