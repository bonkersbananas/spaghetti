import { CameraIcon, ImageIcon } from "@/components/ui/icons";
import { AddPhotoTile, useFilePicker } from "@/components/ui/PhotoTiles";
import { cn } from "@/lib/cn";
import { addPhotosToItem } from "@/lib/items";
import { useIsDesktop } from "@/lib/use-media-query";

/**
 * An idea or build with no photos yet: one tap to give it its first ones. `small` under a plate picture that stands
 * in as the cover (row-sized wells, icon beside the words), so the picture leads.
 */
export function AddFirstPhotos({ itemId, small, className }: { itemId: string; small?: boolean; className?: string }) {
  const isDesktop = useIsDesktop();
  const camera = useFilePicker({ camera: true, onFiles: (files) => addPhotosToItem(itemId, files) });
  const library = useFilePicker({ multiple: true, onFiles: (files) => addPhotosToItem(itemId, files) });
  const size = small ? "row" : "lg";
  return (
    <div className={cn("grid grid-cols-2 gap-3 md:grid-cols-1", !small && "mb-4", className)}>
      {camera.input}
      {library.input}
      {!isDesktop && <AddPhotoTile size={size} icon={CameraIcon} label="Take photo" onClick={camera.open} />}
      <AddPhotoTile
        size={size}
        icon={ImageIcon}
        label={isDesktop ? "Add photos" : "From library"}
        onClick={library.open}
        className="col-span-1"
      />
    </div>
  );
}
