import type { PriceOffer } from "@shared/prisjakt";
import { formatKr } from "@shared/prisjakt";
import { cn } from "@/lib/cn";
import { ExternalIcon } from "./icons";
import { MetaList } from "./MetaList";

/** "checked today", "checked 3 d ago": prices are always found at a time, never a promise. */
export function checkedWords(checkedAt: number, now = Date.now()): string {
  const days = Math.floor(Math.max(0, now - checkedAt) / 86_400_000);
  return days === 0 ? "checked today" : days === 1 ? "checked yesterday" : `checked ${days} d ago`;
}

interface PriceLineProps {
  price: number;
  shop?: string;
  /** When it was found: the sheet says "checked today", the list's rows leave it out to stay short. */
  checkedAt?: number;
  className?: string;
}

/**
 * The cheapest price found, in a quiet line under a thing's name: "189 kr · Kjell". The price is a little heavier
 * than the words around it; nothing is coloured. A `MetaList`, so it wraps cleanly.
 */
export function PriceLine({ price, shop, checkedAt, className }: PriceLineProps) {
  return (
    <MetaList className={cn("text-small text-ink-faint", className)}>
      <span className="text-ink-soft font-semibold">{formatKr(price)}</span>
      {shop && <span className="truncate">{shop}</span>}
      {checkedAt !== undefined && <span>{checkedWords(checkedAt)}</span>}
    </MetaList>
  );
}

interface OfferRowProps {
  offer: PriceOffer;
  /** The product page on Prisjakt (never a shop's clickout): the offers are read from there. */
  href: string;
  /** The cheapest of them. */
  first?: boolean;
}

/** One shop's offer as a tappable row: the shop, whether it is in stock, and the price. Opens the Prisjakt page. */
export function OfferRow({ offer, href, first }: OfferRowProps) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="focus-ring pressable duration-fast hover:bg-ink/4 -mx-2 flex min-h-11 items-center gap-3 rounded-md px-2 py-2 transition-colors"
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-body text-ink truncate">{offer.shop}</span>
        {!offer.inStock && <span className="text-small text-ink-faint">Out of stock</span>}
      </span>
      <span
        className={cn("text-body tabular-nums", first && offer.inStock ? "text-ink font-semibold" : "text-ink-soft")}
      >
        {formatKr(offer.price)}
      </span>
      <ExternalIcon size={14} weight="bold" className="text-ink-faint shrink-0" aria-hidden />
      <span className="sr-only"> (opens Prisjakt in a new tab)</span>
    </a>
  );
}
