import { useState } from "react";
import { WishingBowl } from "@/components/illustrations";
import { IconButton } from "@/components/ui/Button";
import { BuildsIcon } from "@/components/ui/icons";
import { DragHandle, PickTile, RankRow } from "@/components/ui/RankRow";
import { photoSrc } from "@/lib/previews";
import { useSamplePictures } from "./journal";
import { Label, Section } from "./shared";

const link = { to: "/styleguide" } as const;
const noop = () => {};

/** The pieces of a wishlist: ranked rows, the handle they are dragged by, and the picker's tiles. */
export function WishlistsSection() {
  const ready = useSamplePictures();
  const [picked, setPicked] = useState(true);
  const tugboat = ready ? { src: photoSrc("sample-tugboat-photo", "thumb") } : undefined;
  const handle = (name: string) => <DragHandle label={`Move ${name}`} onPointerDown={noop} onMove={noop} />;
  const start = (name: string) => <IconButton icon={BuildsIcon} label={`Start building ${name}`} onClick={noop} />;
  return (
    <Section
      id="wishlists"
      title="Wishlists"
      note="RankRow: a place in a ranked list (the first on a semolina medal), the picture, the name, then actions and the DragHandle, which the arrow keys move too. Lifted while it is dragged. PickTile: an idea to pick, wearing its place once picked."
    >
      <div className="grid gap-8 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label>Rows</Label>
          <RankRow
            rank={1}
            photo={tugboat}
            title="Bath tugboat for Mila"
            meta="for Mila · 2 days ago"
            link={link}
            actions={start("Bath tugboat")}
            handle={handle("Bath tugboat")}
          />
          <RankRow
            rank={2}
            note="Keyhole slots, 160 mm apart."
            title="Wall mount for the router"
            meta="Aug 11"
            link={link}
            actions={start("Wall mount")}
            handle={handle("Wall mount")}
          />
          <RankRow
            rank={3}
            title="Hook for the bike helmet"
            titled={false}
            meta="3 weeks ago"
            link={link}
            actions={start("Hook")}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label>Lifted, while dragged</Label>
          <RankRow
            rank={2}
            note="Bag clips for the coffee"
            title="Bag clips for the coffee"
            titled={false}
            meta="Sep 4"
            link={link}
            lifted
            actions={start("Bag clips")}
            handle={handle("Bag clips")}
            className="scale-102"
          />
          <Label>Pick tiles</Label>
          <div className="grid w-72 grid-cols-3 gap-3">
            <PickTile
              title="Bath tugboat"
              photo={tugboat}
              rank={picked ? 1 : null}
              onToggle={() => setPicked((on) => !on)}
            />
            <PickTile title="Wall mount" note="Keyhole slots, 160 mm apart." rank={null} onToggle={noop} />
            <PickTile title="Bag clips" rank={2} onToggle={noop} />
          </div>
          <Label>Empty</Label>
          <WishingBowl />
        </div>
      </div>
    </Section>
  );
}
