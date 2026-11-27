import { displayName } from "@shared/people";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ToggleChip } from "@/components/ui/Chip";
import { ChipRow } from "@/components/ui/FilterChips";
import { ForField } from "@/components/ui/ForField";
import { ForOffer } from "@/components/ui/ForOffer";
import { UpNextIcon, WishIcon } from "@/components/ui/icons";
import { useForLine, useOtherPerson } from "@/lib/for-whom";
import type { ItemView } from "@/lib/items";
import { sessionQuery } from "@/lib/queries";
import { useKeepEditing } from "@/lib/read-only";
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
 * (Up next, My wishlist) and, while nobody is named, the dashed "For Sam" offer. On a phone the row stays one line and
 * scrolls sideways (`ChipRow`), the toggles first, so a long name never pushes the offer onto a second line.
 */
export function IdeaTitleChips({ item, forWhom, setForWhom, readOnly }: IdeaTitleChipsProps) {
  const queryClient = useQueryClient();
  const { data: user } = useQuery(sessionQuery);
  const wished = useWishlistIds(user?.id).includes(item.id);
  const other = useOtherPerson();
  const forLine = useForLine();
  const [asking, setAsking] = useState(false);
  // Offline, the line being typed in stays editable (it waits to be saved); the others are read-only.
  const keep = useKeepEditing(readOnly);
  const locked = readOnly || item.pending;
  const fieldLocked = keep.readOnly || item.pending;

  return (
    <>
      <ForField
        aria-label="For"
        value={forWhom}
        onChange={(event) => setForWhom(event.target.value)}
        readOnly={fieldLocked}
        onFocus={keep.onFocus}
        onBlur={keep.onBlur}
        asking={asking}
        you={forLine(forWhom) === "for you"}
        onOpen={() => setAsking(true)}
        onDone={() => setAsking(false)}
      />
      {/* Pulled left so the quiet toggles' words line up with the title; the row runs to the screen's edge on phones. */}
      <div className="-ml-2.5">
        <ChipRow label="About this idea" className="items-center md:gap-1 md:py-0">
          <ToggleChip
            selected={item.upNext !== null}
            appearance="quiet"
            tone="semolina"
            icon={UpNextIcon}
            disabled={locked}
            onClick={() => setUpNext(queryClient, item, item.upNext === null)}
          >
            Up next
          </ToggleChip>
          <ToggleChip
            selected={wished}
            appearance="quiet"
            tone="semolina"
            icon={WishIcon}
            disabled={locked || !user}
            onClick={() => user && toggleWishlist(queryClient, user.id, item)}
          >
            My wishlist
          </ToggleChip>
          {!forWhom.trim() && !asking && !locked && (
            <ForOffer name={other && displayName(other)} onName={setForWhom} onAsk={() => setAsking(true)} />
          )}
        </ChipRow>
      </div>
    </>
  );
}
