import type { Person, ShoppingItem } from "@shared/api";
import { priceSearchUrl, shoppingName, tidyPageTitle } from "@shared/shopping";
import { inlineTime } from "@shared/time";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { ChecklistRow, TickBox } from "@/components/ui/Checklist";
import { Chip } from "@/components/ui/Chip";
import { PriceIcon } from "@/components/ui/icons";
import { LinkChip } from "@/components/ui/LinkChip";
import { PriceLine } from "@/components/ui/Prices";
import { Thumb } from "@/components/ui/Thumb";
import { cn } from "@/lib/cn";
import { linkPreviewQuery } from "@/lib/queries";

/** How long a ticked row stays where it was before it moves to Bought. */
const TICK_PAUSE = 450;

/** "eu.store.bambulab.com" → "bambulab.com": the shop as people say it. */
export function shopName(url: string): string {
  try {
    const parts = new URL(url).hostname.toLowerCase().split(".");
    // Keep a country's second level ("co.uk") with its name.
    const keep = parts.length > 2 && ["co", "com"].includes(parts.at(-2) ?? "") ? 3 : 2;
    return parts.slice(-keep).join(".");
  } catch {
    return url;
  }
}

/** What a thing on the list is called, with its page's title standing in while it has no name of its own. */
export function useShoppingName(item: ShoppingItem): string {
  const url = !item.name.trim() ? (item.link ?? item.priceLink) : null;
  const { data } = useQuery({ ...linkPreviewQuery(url ?? ""), enabled: !!url });
  return shoppingName(item, data?.title ? tidyPageTitle(data.title, data.site) : null);
}

interface ShoppingRowProps {
  item: ShoppingItem;
  /** Who ticked it off, for a bought row. */
  boughtBy?: Person;
  onTick: (bought: boolean) => void;
  onOpen: () => void;
  readOnly?: boolean;
  handle?: ReactNode;
  lifted?: boolean;
  last?: boolean;
}

/**
 * A thing on the shopping list: the tick box, its name (a button that opens it), and under it the shop and its
 * Prisjakt page as link chips. A bought row says who got it and when, and its name steps back.
 */
export function ShoppingRow({ item, boughtBy, onTick, onOpen, readOnly, handle, lifted, last }: ShoppingRowProps) {
  const name = useShoppingName(item);
  const bought = item.boughtAt !== null;
  // A tick shows at once and the row stays a beat, so the check is seen landing before it moves to Bought.
  const [ticking, setTicking] = useState(false);
  const pause = useRef<number | null>(null);
  const tickRef = useRef(onTick);
  tickRef.current = onTick;
  function send() {
    pause.current = null;
    tickRef.current(true);
    // Once sent, the box shows the item's own state: if the tick failed or wasn't allowed, it's open again.
    setTicking(false);
  }
  function tick(next: boolean) {
    if (pause.current !== null) {
      // Unticked within the pause: nothing is sent.
      window.clearTimeout(pause.current);
      pause.current = null;
      setTicking(false);
      return;
    }
    if (!next || bought) return onTick(next);
    setTicking(true);
    pause.current = window.setTimeout(send, TICK_PAUSE);
  }
  // Leaving the screen mid-pause still buys it: the tick was made.
  // The page going away (a reload, the app swiped off a phone) counts as leaving too: unmount doesn't run then.
  useEffect(() => {
    const sendNow = () => {
      if (pause.current === null) return;
      window.clearTimeout(pause.current);
      pause.current = null;
      tickRef.current(true);
    };
    window.addEventListener("pagehide", sendNow);
    return () => {
      window.removeEventListener("pagehide", sendNow);
      sendNow();
    };
  }, []);
  const cheapest = item.prices?.offers[0];
  const matched = !item.priceLink && !bought && item.suggestState === "found";
  const links = (
    <>
      {item.prices && !bought && <PriceLine price={item.prices.lowest} shop={cheapest?.shop} className="w-full" />}
      {matched && (
        // Claude's guess, not yet anyone's choice: the dashed chip, which opens the sheet to confirm it.
        <button type="button" onClick={onOpen} className="focus-ring touch-target pressable rounded-pill relative">
          <Chip suggested icon={PriceIcon}>
            Prisjakt match?
          </Chip>
        </button>
      )}
      {item.link && (
        <LinkChip href={item.link} quietArrow>
          {shopName(item.link)}
        </LinkChip>
      )}
      {item.priceLink && (
        // With a price in the line above, the chip is just the word (no coin): both chips then fit on one phone line.
        <LinkChip href={item.priceLink} icon={item.prices && !bought ? undefined : PriceIcon} quietArrow>
          Prisjakt
        </LinkChip>
      )}
    </>
  );
  return (
    <ChecklistRow
      done={bought}
      thumb={<Thumb src={item.picture?.url ?? null} alt="" faded={bought} />}
      lifted={lifted}
      last={last}
      tick={<TickBox checked={bought || ticking} onChange={tick} disabled={readOnly} label={`Bought: ${name}`} />}
      meta={
        bought ? (
          // Right under the name: a line of words, not a row of chips.
          <span className="text-small text-ink-faint -mt-1.5 inline-flex items-center gap-1.5">
            {boughtBy && <Avatar person={boughtBy} size="xs" decorative />}
            <span>
              {boughtBy ? `${boughtBy.name.split(" ")[0]} got it` : "Got it"}{" "}
              {item.boughtAt && inlineTime(item.boughtAt)}
            </span>
          </span>
        ) : item.link || item.priceLink || matched ? (
          links
        ) : undefined
      }
      handle={handle}
    >
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "focus-ring touch-target hover:decoration-ink/25 relative -mx-1 block max-w-full rounded-xs px-1 py-1.5 text-left break-words hover:underline hover:underline-offset-4",
          "text-body",
          bought ? "text-ink-faint decoration-ink/30 line-through" : "text-ink font-semibold",
        )}
      >
        {name}
      </button>
    </ChecklistRow>
  );
}

/** "Find it on Prisjakt": Prisjakt's search for the name, for a thing whose Prisjakt page isn't linked yet. */
export function PriceSearchLink({ name }: { name: string }) {
  return (
    <LinkChip href={priceSearchUrl(name)} icon={PriceIcon}>
      Find it on Prisjakt
    </LinkChip>
  );
}
