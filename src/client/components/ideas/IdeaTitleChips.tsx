import { displayName } from "@shared/people";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ToggleChip } from "@/components/ui/Chip";
import { ForField } from "@/components/ui/ForField";
import { ForOffer } from "@/components/ui/ForOffer";
import { UpNextIcon, WishIcon } from "@/components/ui/icons";
import { useNamesMe, useOtherPerson } from "@/lib/for-whom";
import type { ItemView } from "@/lib/items";
import { sessionQuery } from "@/lib/queries";
import { setUpNext } from "@/lib/up-next";
import { toggleWishlist, useWishlistIds } from "@/lib/wishlist";

interface IdeaTitleChipsProps {
  item: ItemView;
  /** The "for" line as typed, and its autosaving setter (`useItemFields`). */
  forWhom: string;
  setForWhom: (forWhom: string) => void;
  readOnly: boolean;
}

/**
 * What sits under an idea's title: the "for Sam" line once someone is named, then one row of chips: the two toggles
 * (Up next, My wishlist) and, while nobody is named, the dashed "For Sam" offer.
 */
export function IdeaTitleChips({ item, forWhom, setForWhom, readOnly }: IdeaTitleChipsProps) {
  const queryClient = useQueryClient();
  const { data: user } = useQuery(sessionQuery);
  const wished = useWishlistIds(user?.id).includes(item.id);
  const other = useOtherPerson();
  const namesMe = useNamesMe();
  const [asking, setAsking] = useState(false);
  const locked = readOnly || item.pending;

  return (
    <>
      <ForField
        aria-label="For"
        value={forWhom}
        onChange={(event) => setForWhom(event.target.value)}
        readOnly={locked}
        asking={asking}
        you={namesMe(forWhom)}
        onOpen={() => setAsking(true)}
        onDone={() => setAsking(false)}
      />
      <div className="flex flex-wrap gap-2">
        <ToggleChip
          selected={item.upNext !== null}
          icon={UpNextIcon}
          disabled={locked}
          onClick={() => setUpNext(queryClient, item, item.upNext === null)}
        >
          Up next
        </ToggleChip>
        <ToggleChip
          selected={wished}
          icon={WishIcon}
          disabled={locked || !user}
          onClick={() => user && toggleWishlist(queryClient, user.id, item)}
        >
          My wishlist
        </ToggleChip>
        {!forWhom.trim() && !asking && !locked && (
          <ForOffer name={other && displayName(other)} onName={setForWhom} onAsk={() => setAsking(true)} />
        )}
      </div>
    </>
  );
}
