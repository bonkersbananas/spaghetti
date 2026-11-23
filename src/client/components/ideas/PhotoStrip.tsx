import { useQueryClient } from "@tanstack/react-query";
import { Reorder, useDragControls } from "motion/react";
import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import { ActionMenu, ActionMenuItem } from "@/components/ui/ActionMenu";
import { CameraIcon, ImageIcon, MakeCoverIcon, PlusIcon, TrashIcon } from "@/components/ui/icons";
import { PhotoMenuDot } from "@/components/ui/PhotoMenuDot";
import { AddPhotoTile, PhotoThumb, useFilePicker } from "@/components/ui/PhotoTiles";
import { cn } from "@/lib/cn";
import { useHasCamera } from "@/lib/has-camera";
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
  /**
   * A build's attempts' photos (newest attempt first), after its own: tap to show, hold for Make cover and Remove,
   * each marked with its attempt's number. They don't reorder: they stay with their attempt.
   */
  attemptPhotos?: { photo: PhotoView; attempt: number }[];
  /** Makes an attempt's photo the build's cover (an own photo is moved first instead). */
  onCoverAttemptPhoto?: (photoId: string) => void;
  /** The photo set as the cover (`coverPhotoId`); without one the first own photo leads. Making another the cover replaces it. */
  coverId?: string | null;
  onClearCover?: () => void;
}

/**
 * An idea's photos in a row: tap one to show it, drag to reorder (the first
 * is the cover; Alt+arrows with the keyboard), or add more. A finger's swipe scrolls the strip wherever it starts;
 * only a hold picks a photo up to move it. The rare things, Make cover and Remove, are a small
 * menu here, never a control on the big photo (decision 0054): tap the photo that's showing again (its "…" says so),
 * hold any photo with a finger and let go (a hold lifts it; moving it then reorders), or right-click one (with a mouse, its "…" shows on hover). A sheet on phones, a
 * popover from the thumbnail on desktop; Remove goes at once, with Undo.
 */
export function PhotoStrip({
  itemId,
  photos,
  selectedId,
  onSelect,
  fixedCover,
  attemptPhotos = [],
  onCoverAttemptPhoto,
  coverId,
  onClearCover,
}: PhotoStripProps) {
  const queryClient = useQueryClient();
  const isDesktop = useIsDesktop();
  const hasCamera = useHasCamera();
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

  const byId = new Map([...photos, ...attemptPhotos.map((entry) => entry.photo)].map((photo) => [photo.id, photo]));
  const attemptOf = new Map(attemptPhotos.map((entry) => [entry.photo.id, entry.attempt]));
  const total = photos.length + attemptPhotos.length;

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
      cover:
        !fixedCover &&
        !offline &&
        !photo.upload &&
        (attemptOf.has(id)
          ? !!onCoverAttemptPhoto && id !== coverId
          : coverId
            ? id !== coverId
            : order.indexOf(id) > 0),
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
      title: attemptOf.has(id)
        ? `Attempt ${attemptOf.get(id)}'s photo`
        : total > 1
          ? `Photo ${order.indexOf(id) + 1} of ${total}`
          : "This photo",
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
  // While a photo is lifted, taken or dragged the strip keeps the touch: the page doesn't scroll (which would cancel the
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
    // Attempt photos stay with their attempt: only the build's own can be moved.
    if (offline || from < 0) return;
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
    const attempt = attemptOf.get(id);
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
        aria-label={
          attempt
            ? `Photo from attempt ${attempt}${id === coverId && !fixedCover ? ", the cover" : ""}`
            : `Photo ${index + 1}${(coverId ? id === coverId : index === 0) && !fixedCover ? ", the cover" : ""}`
        }
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

  // The add tiles lead the strip at every width: a long one (a build's photos and its attempts') would push them off
  // the end, and adding a photo, one-handed at the printer or at a desk, must not start with a scroll.
  const addTiles = (
    <>
      {hasCamera && <AddPhotoTile size="sm" icon={CameraIcon} label="Take a photo" onClick={camera.open} />}
      <AddPhotoTile size="sm" icon={isDesktop ? PlusIcon : ImageIcon} label="Add photos" onClick={library.open} />
    </>
  );

  return (
    <div
      ref={strip}
      className="-mx-5 flex items-center gap-2.5 overflow-x-auto px-5 pt-2 pb-1 md:mx-0 md:-mt-2 md:px-1"
    >
      {camera.input}
      {library.input}
      {addTiles}
      {draggable ? (
        // Empty (a build whose photos are all its attempts'), a list would still take a gap before the add tiles.
        <Reorder.Group
          as="ul"
          axis="x"
          values={order}
          onReorder={setOrder}
          className="flex shrink-0 gap-2.5 empty:hidden"
          aria-label="Photo order"
          data-movable=""
        >
          {order.map((id, index) => {
            const photo = byId.get(id);
            if (!photo) return null;
            return (
              <OwnPhoto
                key={id}
                id={id}
                movable={!photo.upload && !offline}
                lifted={lifted === id}
                held={longPress.holding}
                onTake={() => {
                  draggingNow.current = true;
                }}
                onLetGo={() => {
                  draggingNow.current = false;
                }}
                onDragStart={() => {
                  draggingNow.current = true;
                  setDragging(true);
                }}
                onDragEnd={() => {
                  draggingNow.current = false;
                  setDragging(false);
                  commit(order);
                }}
              >
                {thumb(id, index, photo)}
              </OwnPhoto>
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
      {attemptPhotos.length > 0 && (
        // Set a little apart, behind a hairline: they are the attempts', not the build's own.
        <ul className="border-ink/10 ml-1 flex shrink-0 gap-2.5 border-l pl-3.5" aria-label="Attempts' photos">
          {attemptPhotos.map(({ photo }, index) => (
            <li key={photo.id} className="group/thumb relative shrink-0 list-none">
              {thumb(photo.id, photos.length + index, photo)}
            </li>
          ))}
        </ul>
      )}
      {menu && (
        <PhotoMenu
          open={menuOpen}
          onOpenChange={setMenuOpen}
          title={menu.title}
          anchor={anchor}
          can={menu.can}
          onCover={() => {
            if (attemptOf.has(menu.id)) {
              onCoverAttemptPhoto?.(menu.id);
              return;
            }
            if (coverId) onClearCover?.();
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

/**
 * One of the item's own photos in the reorderable row. Motion's own drag listener would take every sideways touch
 * (it sets touch-action pan-y), so a swipe could only ever move a photo: instead the drag starts here. With a mouse it
 * starts as the button goes down, as before; with a finger only once a hold has lifted the photo and the finger moves
 * on, so a swipe that starts on a photo scrolls the strip like any other.
 */
function OwnPhoto({
  id,
  movable,
  lifted,
  held,
  onTake,
  onLetGo,
  onDragStart,
  onDragEnd,
  children,
}: {
  id: string;
  movable: boolean;
  lifted: boolean;
  /** Whether a finger's hold has lifted a photo (the long press's `holding`). */
  held: () => boolean;
  /** A lifted photo is being taken somewhere: the strip keeps the touch from here on, before motion's drag starts. */
  onTake: () => void;
  onLetGo: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  children: ReactNode;
}) {
  const controls = useDragControls();
  const taken = useRef(false);
  const letGo = () => {
    taken.current = false;
    onLetGo();
  };
  return (
    <Reorder.Item
      value={id}
      drag={movable ? "x" : false}
      dragListener={false}
      dragControls={controls}
      onPointerDown={(event) => {
        if (movable && event.pointerType === "mouse" && event.button === 0) controls.start(event);
      }}
      // Capture: the long press, on the button inside, puts the photo down once the finger passes its slop, and the
      // drag must have it before then. A drag doesn't end a hold: a finger that wobbles a few px and lets go still gets
      // the menu (the hold ends once it has moved past its slop).
      onPointerMoveCapture={(event) => {
        if (!movable || event.pointerType === "mouse" || taken.current || !held()) return;
        taken.current = true;
        onTake();
        controls.start(event);
      }}
      onPointerUp={letGo}
      onPointerCancel={letGo}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className="group/thumb relative shrink-0 list-none"
      animate={lifted ? LIFTED : RESTING}
      whileDrag={LIFTED}
    >
      {children}
    </Reorder.Item>
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
