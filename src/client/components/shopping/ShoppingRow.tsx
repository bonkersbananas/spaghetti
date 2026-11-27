import type { Person, ShoppingItem } from "@shared/api";
import { formatKr } from "@shared/prisjakt";
import { priceSearchUrl, shoppingName, tidyPageTitle } from "@shared/shopping";
import { filamentFromName } from "@shared/shopping-filament";
import { inlineTime } from "@shared/time";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { lazy, type ReactNode, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { ChecklistName, ChecklistRow, TickBox } from "@/components/ui/Checklist";
import { PantryIcon, PriceIcon } from "@/components/ui/icons";
import { LinkChip } from "@/components/ui/LinkChip";
import { Thumb } from "@/components/ui/Thumb";
import { spoolsQuery } from "@/lib/pantry-queries";
import { linkPreviewQuery } from "@/lib/queries";
import { canEdit } from "@/lib/read-only";
import { keepInPantry } from "@/lib/shopping";

// Its code loads with the first tap on "Add to pantry", not with the list.
const AddSpoolSheet = lazy(() =>
  import("@/components/pantry/AddSpoolSheet").then((m) => ({ default: m.AddSpoolSheet })),
);

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
  /** With the name as the row shows it (a bare link's page title), for the toast. */
  onTick: (bought: boolean, name: string) => void;
  onOpen: () => void;
  readOnly?: boolean;
  handle?: ReactNode;
  lifted?: boolean;
  last?: boolean;
}

/**
 * A thing on the shopping list, on one line: the tick box, its picture when it has one, its name (a button that opens
 * it, where the whole name, the shop and its Prisjakt page are) and the cheapest price found. A bought row says who
 * got it and when at the line's end, and its name steps back; bought filament offers the pantry under it.
 */
export function ShoppingRow({ item, boughtBy, onTick, onOpen, readOnly, handle, lifted, last }: ShoppingRowProps) {
  const name = useShoppingName(item);
  const bought = item.boughtAt !== null;
  // A bought spool of filament offers the pantry: the sheet opens with what its name says.
  const filament = useMemo(() => (bought ? filamentFromName(name) : null), [bought, name]);
  const queryClient = useQueryClient();
  // The spool it became, for both people (the server drops it once the spool is gone; here it goes at once).
  const { data: spools } = useQuery({ ...spoolsQuery, enabled: !!item.spoolId });
  const inPantry =
    item.spoolId && (!spools || spools.some((spool) => spool.id === item.spoolId)) ? item.spoolId : undefined;
  const [adding, setAdding] = useState(false);
  // A tick shows at once and the row stays a beat, so the check is seen landing before it moves to Bought.
  const [ticking, setTicking] = useState(false);
  const pause = useRef<number | null>(null);
  const tickRef = useRef((next: boolean) => onTick(next, name));
  tickRef.current = (next: boolean) => onTick(next, name);
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
    if (!next || bought) return onTick(next, name);
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
  const first = boughtBy?.name.split(" ")[0];
  return (
    <ChecklistRow
      done={bought}
      thumb={item.picture ? <Thumb src={item.picture.url} alt="" faded={bought} /> : undefined}
      lifted={lifted}
      last={last}
      tick={<TickBox checked={bought || ticking} onChange={tick} disabled={readOnly} label={`Bought: ${name}`} />}
      aside={
        bought ? (
          // Who got it and when, quiet at the line's end.
          <>
            {boughtBy && <Avatar person={boughtBy} size="xs" decorative />}
            <span>
              <span className="sr-only">{first ? `${first} got it ` : "Got it "}</span>
              {item.boughtAt && inlineTime(item.boughtAt)}
            </span>
          </>
        ) : item.prices ? (
          // The cheapest price found, quietly: the shops and when it was checked are in its sheet.
          <span className="text-ink-soft tabular-nums">
            <span className="sr-only">Cheapest found: </span>
            {formatKr(item.prices.lowest)}
          </span>
        ) : undefined
      }
      meta={
        filament &&
        (inPantry ? (
          <Link
            to="/pantry/$spoolId"
            params={{ spoolId: inPantry }}
            className="focus-ring touch-target text-small text-ink-faint hover:text-ink decoration-ink/25 relative inline-flex items-center gap-1 rounded-xs underline underline-offset-4"
          >
            <PantryIcon size={14} aria-hidden />
            In the pantry
          </Link>
        ) : (
          !readOnly && (
            <Button
              variant="quiet"
              size="sm"
              icon={PantryIcon}
              onClick={() => canEdit() && setAdding(true)}
              className="touch-target relative -ml-2.5"
            >
              Add to pantry
            </Button>
          )
        ))
      }
      handle={handle}
    >
      <ChecklistName onOpen={onOpen} done={bought}>
        {name}
      </ChecklistName>
      {adding && filament && (
        <Suspense fallback={null}>
          <AddSpoolSheet
            open
            onOpenChange={(open) => !open && setAdding(false)}
            initial={{
              material: filament.material,
              brand: filament.brand,
              finish: filament.finish,
              colorName: filament.colorName,
              colorHex: filament.colorHex,
            }}
            description={`From the list: ${name}.`}
            stayPut
            onAdded={(spool, saved) => void keepInPantry(queryClient, item, spool.id, saved)}
          />
        </Suspense>
      )}
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
