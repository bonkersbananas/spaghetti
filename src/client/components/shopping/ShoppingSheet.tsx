import type { ShoppingItem } from "@shared/api";
import { formatKr, prisjaktProduct } from "@shared/prisjakt";
import { isWebLink, SHOPPING_LINK_MAX, SHOPPING_NAME_MAX } from "@shared/shopping";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { CheckIcon, LinkIcon, PriceIcon, SameAgainIcon, TrashIcon, UndoIcon } from "@/components/ui/icons";
import { checkedWords, OfferRow } from "@/components/ui/Prices";
import { Sheet } from "@/components/ui/Sheet";
import { SuggestionCard, SuggestionNote } from "@/components/ui/Suggestion";
import { Thumb } from "@/components/ui/Thumb";
import { toast } from "@/components/ui/Toast";
import { sessionQuery } from "@/lib/queries";
import { useReadOnly } from "@/lib/read-only";
import {
  checkPrices,
  dismissSuggestion,
  lookForPrisjakt,
  removeShopping,
  setBought,
  shoppingQuery,
  updateShopping,
  usePriceSuggestionsEnabled,
} from "@/lib/shopping";
import { useLiveFields } from "@/lib/use-autosave";
import { PriceSearchLink, useShoppingName } from "./ShoppingRow";

/**
 * A thing on the shopping list, open: its name, the shop's link and its Prisjakt page, all autosaved. "Got it" ticks
 * it off and Delete takes it off the list at once, with an Undo toast.
 */
export function ShoppingSheet({
  itemId,
  onOpenChange,
}: {
  itemId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { data } = useQuery(shoppingQuery);
  const item = data?.find((i) => i.id === itemId);
  return (
    <Sheet
      open={!!itemId && !!item}
      onOpenChange={onOpenChange}
      title="On the list"
      footer={item && <ShoppingActions key={item.id} item={item} onClose={() => onOpenChange(false)} />}
    >
      {item && <ShoppingBody key={item.id} item={item} />}
    </Sheet>
  );
}

/** "Got it" and "Delete", pinned at the sheet's foot. */
function ShoppingActions({ item, onClose }: { item: ShoppingItem; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: me } = useQuery(sessionQuery);
  const readOnly = useReadOnly();
  const shown = useShoppingName(item);
  const bought = item.boughtAt !== null;
  return (
    <div className="flex w-full flex-wrap items-center justify-between gap-3">
      <Button
        variant="secondary"
        icon={bought ? UndoIcon : CheckIcon}
        disabled={readOnly || !me}
        onClick={() => {
          if (me) void setBought(queryClient, item, !bought, me.id);
          onClose();
        }}
      >
        {bought ? "Back on the list" : "Got it"}
      </Button>
      <Button
        variant="quiet"
        icon={TrashIcon}
        disabled={readOnly}
        onClick={() => {
          onClose();
          removeShopping(queryClient, [item], shown);
        }}
      >
        Delete
      </Button>
    </div>
  );
}

const linkError = (value: string) =>
  value.trim() && !isWebLink(value.trim()) ? "A web address, starting with https://" : undefined;

function ShoppingBody({ item }: { item: ShoppingItem }) {
  const queryClient = useQueryClient();
  const readOnly = useReadOnly();
  const shown = useShoppingName(item);
  const { value, change, saveState } = useLiveFields(
    { name: item.name, link: item.link ?? "", priceLink: item.priceLink ?? "" },
    async ({ name, link, priceLink }) => {
      // A link that isn't one yet waits; an emptied one is cleared. A name may be blank when there is a link.
      const next: { name?: string; link?: string | null; priceLink?: string | null } = {};
      if (name !== undefined && (name.trim() || item.link || item.priceLink)) next.name = name.trim();
      if (link !== undefined && !linkError(link)) next.link = link.trim() || null;
      if (priceLink !== undefined && !linkError(priceLink)) next.priceLink = priceLink.trim() || null;
      if (Object.keys(next).length) await updateShopping(queryClient, item.id, next);
    },
  );
  return (
    <div className="flex flex-col gap-5">
      <PriceBlock item={item} name={shown} readOnly={readOnly} />
      <SuggestionBlock
        item={item}
        readOnly={readOnly}
        use={(url) => {
          change({ priceLink: url });
        }}
      />
      <fieldset disabled={readOnly} className="contents">
        <TextField
          label="Name"
          value={value.name}
          placeholder={shown}
          maxLength={SHOPPING_NAME_MAX}
          saveState={saveState}
          enterKeyHint="done"
          onChange={(event) => change({ name: event.target.value })}
        />
        <TextField
          label="Shop"
          type="url"
          inputMode="url"
          icon={LinkIcon}
          value={value.link}
          placeholder="https://"
          maxLength={SHOPPING_LINK_MAX}
          error={linkError(value.link)}
          enterKeyHint="done"
          onChange={(event) => change({ link: event.target.value })}
        />
        <TextField
          label="Prisjakt"
          type="url"
          inputMode="url"
          icon={PriceIcon}
          value={value.priceLink}
          placeholder="https://www.prisjakt.nu/…"
          maxLength={SHOPPING_LINK_MAX}
          error={linkError(value.priceLink)}
          hint={
            value.priceLink.trim() ? undefined : (
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                Paste its Prisjakt page to compare prices from the list.
                <PriceSearchLink name={value.name.trim() || shown} />
              </span>
            )
          }
          enterKeyHint="done"
          onChange={(event) => change({ priceLink: event.target.value })}
        />
      </fieldset>
    </div>
  );
}

/**
 * The picture and what the Prisjakt page said about the price: the cheapest offers as tappable rows, when they were
 * found, and "Check prices again". Nothing shows for a thing with no Prisjakt product page and no picture; prices
 * are always "found", never promised.
 */
function PriceBlock({ item, name, readOnly }: { item: ShoppingItem; name: string; readOnly: boolean }) {
  const queryClient = useQueryClient();
  const [checking, setChecking] = useState(false);
  const product = item.priceLink ? prisjaktProduct(item.priceLink) : null;
  const { prices, picture } = item;
  if (!product && !picture) return null;
  async function again() {
    setChecking(true);
    try {
      await checkPrices(queryClient, item.id);
    } catch {
      toast.error("Couldn't check the prices", "Try again in a moment.");
    } finally {
      setChecking(false);
    }
  }
  const waiting = !!product && !prices && item.pricesTriedAt === null;
  return (
    <section aria-label="Prices" className="flex flex-col gap-3">
      <div className="flex items-start gap-4">
        {picture && <Thumb src={picture.url} alt={name} size="sheet" />}
        {product && (
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            {prices ? (
              <>
                <p className="text-small text-ink-faint">Cheapest found</p>
                <p className="text-title text-ink font-semibold tabular-nums">{formatKr(prices.lowest)}</p>
                <p className="text-small text-ink-faint">
                  {checkedWords(prices.checkedAt)}
                  {prices.count ? ` · ${prices.count} ${prices.count === 1 ? "shop" : "shops"} on Prisjakt` : ""}
                </p>
              </>
            ) : (
              <p className="text-small text-ink-faint">
                {waiting ? "Reading the Prisjakt page…" : "Couldn't read prices from that page."}
              </p>
            )}
            <Button
              variant="quiet"
              icon={SameAgainIcon}
              loading={checking}
              disabled={readOnly || checking}
              onClick={again}
              className="-ml-3 self-start"
            >
              Check prices again
            </Button>
          </div>
        )}
      </div>
      {prices && prices.offers.length > 0 && item.priceLink && (
        <ul aria-label="Cheapest offers" className="flex flex-col">
          {prices.offers.map((offer, index) => (
            <li key={offer.shop}>
              <OfferRow offer={offer} href={product?.url ?? item.priceLink ?? ""} first={index === 0} />
            </li>
          ))}
        </ul>
      )}
      {prices && (
        <p className="text-small text-ink-faint">
          Prices are as Prisjakt showed them then; they change. Wrong product? Paste another Prisjakt link below.
        </p>
      )}
    </section>
  );
}

/**
 * Where the thing has no Prisjakt page: the one a search found, to confirm ("Is this it?"), or a note that the search
 * is on its way or found nothing, with "Look for it". Nothing here is used until a person taps "Use it".
 */
function SuggestionBlock({
  item,
  readOnly,
  use,
}: {
  item: ShoppingItem;
  readOnly: boolean;
  use: (url: string) => void;
}) {
  const queryClient = useQueryClient();
  const enabled = usePriceSuggestionsEnabled();
  if (item.priceLink || !enabled) return null;
  const { suggestion, suggestState } = item;
  if (suggestion) {
    return (
      <SuggestionCard
        title={suggestion.title}
        href={suggestion.url}
        disabled={readOnly}
        onUse={() => use(suggestion.url)}
        onDismiss={() =>
          void dismissSuggestion(queryClient, item.id).catch(() =>
            toast.error("Couldn't do that", "Try again in a moment."),
          )
        }
      />
    );
  }
  if (suggestState === "searching") return <SuggestionNote>Looking for it on Prisjakt…</SuggestionNote>;
  if (!item.name.trim()) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3">
      <SuggestionNote>
        {suggestState === "none" ? "No Prisjakt page found for it." : "Not looked for on Prisjakt yet."}
      </SuggestionNote>
      <Button
        variant="quiet"
        icon={SameAgainIcon}
        disabled={readOnly}
        onClick={() =>
          void lookForPrisjakt(queryClient, item.id).catch(() =>
            toast.error("Couldn't look for it", "Try again in a moment."),
          )
        }
      >
        Look for it
      </Button>
    </div>
  );
}
