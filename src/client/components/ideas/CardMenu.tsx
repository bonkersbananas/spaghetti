import { useQuery, useQueryClient } from "@tanstack/react-query";
import { lazy, type ReactNode, Suspense, useState } from "react";
import { MoreIcon, MoveDownIcon, MoveIntoIcon, MoveUpIcon, UpNextIcon, WishIcon } from "@/components/ui/icons";
import { Popover, PopoverClose } from "@/components/ui/Popover";
import { Sheet } from "@/components/ui/Sheet";
import { toast } from "@/components/ui/Toast";
import type { ItemView } from "@/lib/items";
import { whyNotMove } from "@/lib/move";
import { sessionQuery } from "@/lib/queries";
import { useIsDesktop } from "@/lib/use-media-query";
import { toggleWishlist, useWishlistIds } from "@/lib/wishlist";
import type { UpNextMenu } from "./IdeaCard";

const MoveToBuildSheet = lazy(() => import("./MoveToBuildSheet").then((m) => ({ default: m.MoveToBuildSheet })));

/** The card's "…" button: Up next, where it stands in the queue, your wishlist and adding it to a build. A link can't hold a button, so it sits over the card. */
export function CardMenu({ menu, name, item }: { menu: UpNextMenu; name: string; item: ItemView }) {
  const isDesktop = useIsDesktop();
  const [open, setOpen] = useState(false);
  // A closed phone sheet still costs a vaul root with its scroll and resize listeners, and every card has one:
  // mount it with the first tap (it stays mounted afterwards, so closing animates).
  const [asked, setAsked] = useState(false);
  // The build picker is its own chunk, fetched when the row is first chosen.
  const [moving, setMoving] = useState<"closed" | "open">("closed");
  const [moveAsked, setMoveAsked] = useState(false);
  const queryClient = useQueryClient();
  const me = useQuery(sessionQuery).data?.id;
  const wished = useWishlistIds(me).includes(menu.wish?.id ?? "");
  const row =
    "text-body text-ink hover:bg-ink/5 focus-visible:bg-ink/5 flex min-h-12 w-full items-center gap-3 rounded-md px-3 text-left outline-none md:min-h-11";
  const actions = (
    <div className="flex flex-col">
      <MenuRow onSelect={menu.onToggle} className={row} close={isDesktop ? undefined : () => setOpen(false)}>
        <UpNextIcon size={20} aria-hidden />
        {menu.queued ? "Take off Up next" : "Up next"}
      </MenuRow>
      {menu.onMoveUp && (
        <MenuRow onSelect={menu.onMoveUp} className={row} close={isDesktop ? undefined : () => setOpen(false)}>
          <MoveUpIcon size={20} aria-hidden />
          Move up
        </MenuRow>
      )}
      {menu.onMoveDown && (
        <MenuRow onSelect={menu.onMoveDown} className={row} close={isDesktop ? undefined : () => setOpen(false)}>
          <MoveDownIcon size={20} aria-hidden />
          Move down
        </MenuRow>
      )}
      {menu.wish && me && (
        <MenuRow
          onSelect={() => menu.wish && toggleWishlist(queryClient, me, menu.wish)}
          className={row}
          close={isDesktop ? undefined : () => setOpen(false)}
        >
          <WishIcon size={20} weight={wished ? "fill" : "regular"} aria-hidden />
          {wished ? "Take off your wishlist" : "Add to your wishlist"}
        </MenuRow>
      )}
      <MenuRow
        onSelect={() => {
          const why = whyNotMove(queryClient, item);
          if (why) return toast.message("It stays where it is", why);
          setMoveAsked(true);
          setMoving("open");
        }}
        className={row}
        close={isDesktop ? undefined : () => setOpen(false)}
      >
        <MoveIntoIcon size={20} aria-hidden />
        Add to a build…
      </MenuRow>
    </div>
  );
  const picker = moveAsked && (
    <Suspense fallback={null}>
      <MoveToBuildSheet
        open={moving === "open"}
        onOpenChange={(next) => setMoving(next ? "open" : "closed")}
        idea={item}
      />
    </Suspense>
  );
  // Over the card's bottom-right corner, at the end of the avatar's row: the photo and a note's words stay clear.
  const button = (
    <button
      type="button"
      aria-label={`Options for ${name}`}
      title="Options"
      onClick={
        isDesktop
          ? undefined
          : () => {
              setAsked(true);
              setOpen(true);
            }
      }
      className="pressable focus-ring touch-target text-ink-soft hover:bg-ink/5 hover:text-ink absolute right-1 bottom-3 flex size-10 items-center justify-center rounded-full transition-colors"
    >
      <MoreIcon size={20} weight="bold" aria-hidden />
    </button>
  );
  if (!isDesktop) {
    return (
      <>
        {button}
        {asked && (
          <Sheet
            open={open}
            onOpenChange={setOpen}
            title={name}
            description="Up next is the queue you share; your wishlist is your own top ideas."
          >
            {actions}
          </Sheet>
        )}
        {picker}
      </>
    );
  }
  return (
    <>
      <Popover label={`Options for ${name}`} side="bottom" align="end" className="w-56 p-1.5" trigger={button}>
        {actions}
      </Popover>
      {picker}
    </>
  );
}

/** One action in the menu; on desktop the popover closes around it, on phones the sheet is closed by hand. */
function MenuRow({
  onSelect,
  close,
  className,
  children,
}: {
  onSelect: () => void;
  close?: () => void;
  className: string;
  children: ReactNode;
}) {
  const button = (
    <button
      type="button"
      className={className}
      onClick={() => {
        onSelect();
        close?.();
      }}
    >
      {children}
    </button>
  );
  return close ? button : <PopoverClose asChild>{button}</PopoverClose>;
}
