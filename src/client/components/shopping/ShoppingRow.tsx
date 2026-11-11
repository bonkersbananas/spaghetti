import type { Person, ShoppingItem } from "@shared/api";
import { priceSearchUrl, shoppingName, tidyPageTitle } from "@shared/shopping";
import { inlineTime } from "@shared/time";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { ChecklistRow, TickBox } from "@/components/ui/Checklist";
import { LinkChip } from "@/components/ui/Chip";
import { PriceIcon } from "@/components/ui/icons";
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
  const links = (
    <>
      {item.link && <LinkChip href={item.link}>{shopName(item.link)}</LinkChip>}
      {item.priceLink && (
        <LinkChip href={item.priceLink} icon={PriceIcon}>
          Prisjakt
        </LinkChip>
      )}
    </>
  );
  return (
    <ChecklistRow
      done={bought}
      lifted={lifted}
      last={last}
      tick={
        <TickBox
          checked={bought || ticking}
          onChange={(next) => {
            if (!next || bought) return onTick(next);
            setTicking(true);
            window.setTimeout(() => onTick(true), TICK_PAUSE);
          }}
          disabled={readOnly}
          label={`Bought: ${name}`}
        />
      }
      meta={
        bought ? (
          <span className="text-small text-ink-faint">
            {boughtBy ? `${boughtBy.name.split(" ")[0]} got it` : "Got it"} {item.boughtAt && inlineTime(item.boughtAt)}
          </span>
        ) : item.link || item.priceLink ? (
          links
        ) : undefined
      }
      handle={handle}
    >
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "focus-ring hover:decoration-ink/25 -mx-1 block max-w-full rounded-xs px-1 py-1.5 text-left break-words hover:underline hover:underline-offset-4",
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
