import { CameraIcon, ImageIcon } from "@/components/ui/icons";
import { AddPhotoTile, useFilePicker } from "@/components/ui/PhotoTiles";
import { cn } from "@/lib/cn";
import { addPhotosToItem } from "@/lib/items";
import { useIsDesktop } from "@/lib/use-media-query";

/**
 * An idea or build with no photos yet: one tap to give it its first ones. `small` under a plate picture that stands
 * in as the cover (row-sized wells, icon beside the words), so the picture leads.
 *
 * Without a picture the two places differ by device. On a keyboard the big well sits above the title, in the column
 * that has the room. On a phone it would take the first screen from the title, so there it is `row`: one slim line of
 * two pills (camera, library) that the page puts under the title and its chips, and the big well draws nothing.
 */
export function AddFirstPhotos({
  itemId,
  small,
  row,
  className,
}: {
  itemId: string;
  small?: boolean;
  /** The phone's slim line under the title: nothing on a keyboard, where the big well above the title is. */
  row?: boolean;
  className?: string;
}) {
  const isDesktop = useIsDesktop();
  const camera = useFilePicker({ camera: true, onFiles: (files) => addPhotosToItem(itemId, files) });
  const library = useFilePicker({ multiple: true, onFiles: (files) => addPhotosToItem(itemId, files) });
  if (!small && (row ? isDesktop : !isDesktop)) return null;
  const size = small ? "row" : row ? "compact" : "lg";
  return (
    <div className={cn("grid grid-cols-2 gap-3 md:grid-cols-1", !small && !row && "mb-4", className)}>
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
