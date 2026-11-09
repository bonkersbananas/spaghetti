import { useQueryClient } from "@tanstack/react-query";
import { Reorder } from "motion/react";
import { useEffect, useState } from "react";
import { CameraIcon, ImageIcon, PlusIcon } from "@/components/ui/icons";
import { AddPhotoTile, PhotoThumb, useFilePicker } from "@/components/ui/PhotoTiles";
import { cn } from "@/lib/cn";
import { addPhotosToItem, type PhotoView, removePhoto, reorderPhotos } from "@/lib/items";
import { photoSrc } from "@/lib/previews";
import { useIsDesktop } from "@/lib/use-media-query";

interface PhotoStripProps {
  itemId: string;
  photos: PhotoView[];
  selectedId: string | undefined;
  onSelect: (photoId: string) => void;
}

/**
 * An idea's photos in a row: tap one to show it, drag to reorder (the first
 * is the cover; Alt+arrows with the keyboard), remove the selected one, or
 * add more.
 */
export function PhotoStrip({ itemId, photos, selectedId, onSelect }: PhotoStripProps) {
  const queryClient = useQueryClient();
  const isDesktop = useIsDesktop();
  const camera = useFilePicker({ camera: true, onFiles: (files) => addPhotosToItem(itemId, files) });
  const library = useFilePicker({ multiple: true, onFiles: (files) => addPhotosToItem(itemId, files) });
  const ids = photos.map((photo) => photo.id);
  const [order, setOrder] = useState(ids);
  const [dragging, setDragging] = useState(false);
  const key = ids.join();

  // Follow the server's order (and new photos) unless a drag is under way.
  // biome-ignore lint/correctness/useExhaustiveDependencies: key stands for ids.
  useEffect(() => {
    if (!dragging) setOrder(ids);
  }, [key, dragging]);

  const byId = new Map(photos.map((photo) => [photo.id, photo]));

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
    const to = from + by;
    if (to < 0 || to >= order.length) return;
    const next = [...order];
    next.splice(from, 1);
    next.splice(to, 0, photoId);
    setOrder(next);
    commit(next);
  }

  return (
    <div className="-mx-5 flex items-center gap-2.5 overflow-x-auto px-5 pt-2 pb-1 md:mx-0 md:-mt-2 md:px-1">
      {camera.input}
      {library.input}
      <Reorder.Group
        as="ul"
        axis="x"
        values={order}
        onReorder={setOrder}
        className="flex shrink-0 gap-2.5"
        aria-label="Photo order"
      >
        {order.map((id, index) => {
          const photo = byId.get(id);
          if (!photo) return null;
          const selected = id === selectedId;
          return (
            <Reorder.Item
              key={id}
              value={id}
              drag={photo.upload ? false : "x"}
              onDragStart={() => setDragging(true)}
              onDragEnd={() => {
                setDragging(false);
                commit(order);
              }}
              className="relative shrink-0 list-none"
              whileDrag={{ scale: 1.06, zIndex: 10 }}
            >
              <button
                type="button"
                onClick={() => onSelect(id)}
                onKeyDown={(event) => {
                  if (!event.altKey) return;
                  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                    event.preventDefault();
                    event.stopPropagation();
                    move(id, event.key === "ArrowLeft" ? -1 : 1);
                  }
                }}
                aria-label={`Photo ${index + 1}${index === 0 ? ", the cover" : ""}`}
                aria-current={selected || undefined}
                aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
                className={cn(
                  "pressable focus-ring block rounded-md",
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
              {selected && (
                <button
                  type="button"
                  onClick={() => removePhoto(queryClient, photo)}
                  aria-label="Remove this photo"
                  className="pressable focus-ring bg-veil-strong text-on-veil shadow-raised absolute -top-2 -right-2 flex size-6 items-center justify-center rounded-full"
                >
                  <PlusIcon size={14} weight="bold" className="rotate-45" aria-hidden />
                </button>
              )}
            </Reorder.Item>
          );
        })}
      </Reorder.Group>
      {!isDesktop && <AddPhotoTile size="sm" icon={CameraIcon} label="Take a photo" onClick={camera.open} />}
      <AddPhotoTile size="sm" icon={isDesktop ? PlusIcon : ImageIcon} label="Add photos" onClick={library.open} />
    </div>
  );
}
