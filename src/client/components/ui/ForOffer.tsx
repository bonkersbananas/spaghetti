import { useState } from "react";
import { OfferChip, OfferMore } from "./Chip";
import { InviteIcon, RenameIcon } from "./icons";
import { MenuGroup, MenuItem } from "./Menu";
import { PopoverAnchor, PopoverPanel, PopoverRoot, PopoverTrigger } from "./Popover";

interface ForOfferProps {
  /** The other person's name: one tap names them. Unknown (the people haven't loaded), only "For someone…" is offered. */
  name?: string;
  /** Name them: the page sets its "for" line, and this offer goes. */
  onName: (name: string) => void;
  /** "Someone else…": the page opens its empty `ForField` with the focus in it. */
  onAsk: () => void;
}

/**
 * Who it is for, offered once among a title's chips while nobody is named: "For Sam" in one tap, and "Someone else…"
 * behind the caret, which opens the `ForField`. Dashed, as an offer and not a fact; once someone is named the page
 * shows the "for Sam" line instead.
 */
export function ForOffer({ name, onName, onAsk }: ForOfferProps) {
  const [open, setOpen] = useState(false);
  if (!name) return <OfferChip onClick={onAsk}>For someone…</OfferChip>;
  return (
    <PopoverRoot open={open} onOpenChange={setOpen}>
      {/* The menu hangs from the whole offer, under its first word, not from the caret. */}
      <PopoverAnchor asChild>
        <span className="inline-flex">
          <OfferChip
            onClick={() => onName(name)}
            more={
              <PopoverTrigger asChild>
                <OfferMore label="For someone else" />
              </PopoverTrigger>
            }
          >
            For {name}
          </OfferChip>
        </span>
      </PopoverAnchor>
      {/* max-w: a menu's 18 rem is wide for two short rows (the panel's own width class can't be overridden). */}
      <PopoverPanel label="Who it is for" side="bottom" align="start" className="max-w-60">
        <MenuGroup size="sm" className="mx-0">
          <MenuItem
            icon={InviteIcon}
            className="max-md:h-11"
            onClick={() => {
              setOpen(false);
              onName(name);
            }}
          >
            For {name}
          </MenuItem>
          <MenuItem
            icon={RenameIcon}
            className="max-md:h-11"
            onClick={() => {
              setOpen(false);
              onAsk();
            }}
          >
            Someone else…
          </MenuItem>
        </MenuGroup>
      </PopoverPanel>
    </PopoverRoot>
  );
}
