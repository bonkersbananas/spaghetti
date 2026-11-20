import { useQueryClient } from "@tanstack/react-query";
import { Reorder } from "motion/react";
import { type RefObject, useEffect, useRef, useState } from "react";
import { ActionMenu, ActionMenuItem } from "@/components/ui/ActionMenu";
import { CameraIcon, ImageIcon, MakeCoverIcon, PlusIcon, TrashIcon } from "@/components/ui/icons";
import { PhotoMenuDot } from "@/components/ui/PhotoMenuDot";
import { AddPhotoTile, PhotoThumb, useFilePicker } from "@/components/ui/PhotoTiles";
import { cn } from "@/lib/cn";
import { addPhotosToItem, type PhotoView, removePhoto, reorderPhotos } from "@/lib/items";
import { useLongPress } from "@/lib/long-press";
import { photoSrc } from "@/lib/previews";
import { useReadOnly } from "@/lib/read-only";
import { useAfterPaint, useIsDesktop } from "@/lib/use-media-query";

/** A photo held or dragged by the finger stands up from the strip; let go, it settles back. */
const LIFTED = { scale: 1.06, zIndex: 10 };
const RESTING = { scale: 1, zIndex: 0 };

interface PhotoStripProps {
  itemId: string;
  photos: PhotoView[];
  selectedId: string | undefined;
  onSelect: (photoId: string) => void;
  /** The cover is chosen elsewhere (a finished build's final photo): the first photo isn't it, so no "Make cover". */
  fixedCover?: boolean;
}

/**
 * An idea's photos in a row: tap one to show it, drag to reorder (the first
 * is the cover; Alt+arrows with the keyboard), or add more. The rare things, Make cover and Remove, are a small
 * menu here, never a control on the big photo (decision 0054): tap the photo that's showing again (its "…" says so),
 * hold any photo with a finger and let go (a hold lifts it; moving it then reorders), or right-click one (with a mouse, its "…" shows on hover). A sheet on phones, a
 * popover from the thumbnail on desktop; Remove goes at once, with Undo.
 */
export function PhotoStrip({ itemId, photos, selectedId, onSelect, fixedCover }: PhotoStripProps) {
  const queryClient = useQueryClient();
  const isDesktop = useIsDesktop();
  // Saved photos can't be moved or removed without a connection; adding more waits in the outbox.
  const offline = useReadOnly();
  const camera = useFilePicker({ camera: true, onFiles: (files) => addPhotosToItem(itemId, files) });
  const library = useFilePicker({ multiple: true, onFiles: (files) => addPhotosToItem(itemId, files) });
  const ids = photos.map((photo) => photo.id);
  const [order, setOrder] = useState(ids);
  const [dragging, setDragging] = useState(false);
  // Drag-to-reorder (motion's layout projection measures every thumbnail on mount) joins after the first paint.
  const draggable = useAfterPaint();
  const key = ids.join();

  // Follow the server's order (and new photos) unless a drag is under way.
  // biome-ignore lint/correctness/useExhaustiveDependencies: key stands for ids.
  useEffect(() => {
    if (!dragging) setOrder(ids);
  }, [key, dragging]);

  const byId = new Map(photos.map((photo) => [photo.id, photo]));

  // The menu: which photo it is for, the thumbnail it hangs from (desktop) and gets focus back.
  // What it offers is fixed as it opens, so its rows don't change under the finger (or as it closes after Remove).
  const [menu, setMenu] = useState<{ id: string; title: string; can: { cover: boolean; remove: boolean } } | null>(
    null,
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const thumbs = useRef(new Map<string, HTMLButtonElement>());
  const anchor = useRef<HTMLButtonElement | null>(null);
  const actions = (id: string) => {
    const photo = byId.get(id);
    if (!photo) return { cover: false, remove: false };
    return {
      // Photos still uploading keep their place at the end; saved ones can't move or go without a connection.
      cover: !fixedCover && !offline && !photo.upload && order.indexOf(id) > 0,
      remove: !offline || !!photo.upload,
    };
  };
  const hasActions = (id: string) => {
    const can = actions(id);
    return can.cover || can.remove;
  };
  function openMenu(id: string) {
    if (!hasActions(id)) return;
    if (id !== selectedId) onSelect(id);
    anchor.current = thumbs.current.get(id) ?? null;
    setMenu({
      id,
      title: photos.length > 1 ? `Photo ${order.indexOf(id) + 1} of ${photos.length}` : "This photo",
      can: actions(id),
    });
    setMenuOpen(true);
  }
  // A finger's hold lifts the photo (the look it has while dragged): moving it on takes it to a new place, letting go
  // where it is opens the menu. Nothing opens under the finger, which may still be on its way somewhere.
  const [lifted, setLifted] = useState<string | null>(null);
  const longPress = useLongPress(
    (target) => {
      const id = target.dataset.photoId;
      if (id) openMenu(id);
    },
    (target) => {
      // The lift replaces the pressed look (touch-press.ts lets go of it as the finger does).
      target?.removeAttribute("data-pressed");
      setLifted(target?.dataset.photoId ?? null);
    },
  );
  // While a photo is lifted or dragged the strip keeps the touch: the page doesn't scroll (which would cancel the
  // drag) and a downward move doesn't pull the page back (pull-to-go.ts leaves a touch someone has taken). A
  // listener of its own, because React's touch listeners are passive.
  const strip = useRef<HTMLDivElement>(null);
  const draggingNow = useRef(false);
  const holding = useRef<() => boolean>(() => false);
  holding.current = () => longPress.holding() || draggingNow.current;
  useEffect(() => {
    const element = strip.current;
    if (!element) return;
    const keep = (event: TouchEvent) => {
      if (holding.current() && event.cancelable) event.preventDefault();
    };
    element.addEventListener("touchmove", keep, { passive: false });
    return () => element.removeEventListener("touchmove", keep);
  }, []);

  function commit(next: string[]) {
    if (next.join() === key) return;
    // Photos still uploading keep their place at the end until they're saved.
    reorderPhotos(
      queryClient,
      itemId,
      next.filter((id) => !byId.get(id)?.upload),
    );
  }

  function move(photoId: string, by: number) {
    const from = order.indexOf(photoId);
    if (offline) return;
    const to = from + by;
    if (to < 0 || to >= order.length) return;
    const next = [...order];
    next.splice(from, 1);
    next.splice(to, 0, photoId);
    setOrder(next);
    commit(next);
  }

  const thumb = (id: string, index: number, photo: PhotoView) => {
    const selected = id === selectedId;
    const actionable = hasActions(id);
    const button = (
      <button
        type="button"
        ref={(el) => {
          if (el) thumbs.current.set(id, el);
          else thumbs.current.delete(id);
        }}
        data-photo-id={id}
        {...longPress.handlers}
        // The photo showing: a second tap is for what else to do with it.
        onClick={() => (selected && actionable ? openMenu(id) : onSelect(id))}
        onKeyDown={(event) => {
          if (!event.altKey) return;
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            event.stopPropagation();
            move(id, event.key === "ArrowLeft" ? -1 : 1);
          }
        }}
        aria-label={`Photo ${index + 1}${index === 0 && !fixedCover ? ", the cover" : ""}`}
        aria-current={selected || undefined}
        aria-haspopup={selected && actionable ? "dialog" : undefined}
        aria-description={selected && actionable ? "Press again for Make cover and Remove" : undefined}
        aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
        className={cn(
          // No callout, text selection or image drag under a finger that holds it, its photo's included (app.css
          // gives a pressable's photos the save menu back): the hold is ours, to lift it.
          "pressable focus-ring block rounded-md select-none [-webkit-touch-callout:none]",
          "[&_img]:[-webkit-touch-callout:none] [&_img]:[-webkit-user-drag:none]",
          selected && "ring-semolina ring-offset-paper ring-2 ring-offset-2",
        )}
      >
        <PhotoThumb
          size="sm"
          src={photoSrc(id, "thumb")}
          alt={`Photo ${index + 1}`}
          color={photo.color || undefined}
          busy={!!photo.upload}
        />
      </button>
    );
    if (!actionable) return button;
    // The "…" on its corner: always on the photo showing (a second tap opens the menu), on the others with a mouse
    // over them.
    return (
      <>
        {button}
        <PhotoMenuDot shown={selected} onClick={() => openMenu(id)} />
      </>
    );
  };

  return (
    <div
      ref={strip}
      className="-mx-5 flex items-center gap-2.5 overflow-x-auto px-5 pt-2 pb-1 md:mx-0 md:-mt-2 md:px-1"
    >
      {camera.input}
      {library.input}
      {draggable ? (
        // Empty (a build whose photos are all its attempts'), a list would still take a gap before the add tiles.
        <Reorder.Group
          as="ul"
          axis="x"
          values={order}
          onReorder={setOrder}
          className="flex shrink-0 gap-2.5 empty:hidden"
          aria-label="Photo order"
        >
          {order.map((id, index) => {
            const photo = byId.get(id);
            if (!photo) return null;
            return (
              <Reorder.Item
                key={id}
                value={id}
                drag={photo.upload || offline ? false : "x"}
                // A drag doesn't end a hold: a finger that wobbles a few px and lets go still gets the menu (the
                // hold ends once it has moved past its slop).
                onDragStart={() => {
                  draggingNow.current = true;
                  setDragging(true);
                }}
                onDragEnd={() => {
                  draggingNow.current = false;
                  setDragging(false);
                  commit(order);
                }}
                className="group/thumb relative shrink-0 list-none"
                animate={lifted === id ? LIFTED : RESTING}
                whileDrag={LIFTED}
              >
                {thumb(id, index, photo)}
              </Reorder.Item>
            );
          })}
        </Reorder.Group>
      ) : (
        <ul className="flex shrink-0 gap-2.5 empty:hidden" aria-label="Photo order">
          {order.map((id, index) => {
            const photo = byId.get(id);
            if (!photo) return null;
            return (
              <li key={id} className="group/thumb relative shrink-0 list-none">
                {thumb(id, index, photo)}
              </li>
            );
          })}
        </ul>
      )}
      {!isDesktop && <AddPhotoTile size="sm" icon={CameraIcon} label="Take a photo" onClick={camera.open} />}
      <AddPhotoTile size="sm" icon={isDesktop ? PlusIcon : ImageIcon} label="Add photos" onClick={library.open} />
      {menu && (
        <PhotoMenu
          open={menuOpen}
          onOpenChange={setMenuOpen}
          title={menu.title}
          anchor={anchor}
          can={menu.can}
          onCover={() => {
            const next = [menu.id, ...order.filter((id) => id !== menu.id)];
            setOrder(next);
            commit(next);
          }}
          onRemove={() => {
            const photo = byId.get(menu.id);
            if (photo) removePhoto(queryClient, photo);
          }}
        />
      )}
    </div>
  );
}

function PhotoMenu({
  open,
  onOpenChange,
  title,
  anchor,
  can,
  onCover,
  onRemove,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  anchor: RefObject<HTMLButtonElement | null>;
  can: { cover: boolean; remove: boolean };
  onCover: () => void;
  onRemove: () => void;
}) {
  return (
    <ActionMenu open={open} onOpenChange={onOpenChange} title={title} anchor={anchor} returnFocus={anchor}>
      {can.cover && (
        <ActionMenuItem icon={MakeCoverIcon} onSelect={onCover}>
          Make cover
        </ActionMenuItem>
      )}
      {can.remove && (
        <ActionMenuItem icon={TrashIcon} tone="danger" onSelect={onRemove}>
          Remove photo
        </ActionMenuItem>
      )}
    </ActionMenu>
  );
}
