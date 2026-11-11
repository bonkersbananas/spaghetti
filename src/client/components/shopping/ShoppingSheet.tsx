import type { ShoppingItem } from "@shared/api";
import { isWebLink, SHOPPING_LINK_MAX, SHOPPING_NAME_MAX } from "@shared/shopping";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { CheckIcon, LinkIcon, PriceIcon, TrashIcon, UndoIcon } from "@/components/ui/icons";
import { Sheet } from "@/components/ui/Sheet";
import { sessionQuery } from "@/lib/queries";
import { useReadOnly } from "@/lib/read-only";
import { removeShopping, setBought, shoppingQuery, updateShopping } from "@/lib/shopping";
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
    <Sheet open={!!itemId && !!item} onOpenChange={onOpenChange} title="On the list">
      {item && <ShoppingBody key={item.id} item={item} onClose={() => onOpenChange(false)} />}
    </Sheet>
  );
}

const linkError = (value: string) =>
  value.trim() && !isWebLink(value.trim()) ? "A web address, starting with https://" : undefined;

function ShoppingBody({ item, onClose }: { item: ShoppingItem; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: me } = useQuery(sessionQuery);
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
  const bought = item.boughtAt !== null;
  return (
    <div className="flex flex-col gap-5">
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
      <div className="flex flex-wrap items-center justify-between gap-3">
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
    </div>
  );
}
