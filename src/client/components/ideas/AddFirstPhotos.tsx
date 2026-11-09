import { CameraIcon, ImageIcon } from "@/components/ui/icons";
import { AddPhotoTile, useFilePicker } from "@/components/ui/PhotoTiles";
import { addPhotosToItem } from "@/lib/items";
import { useIsDesktop } from "@/lib/use-media-query";

/** An idea or build with no photos yet: one tap to give it its first ones. */
export function AddFirstPhotos({ itemId }: { itemId: string }) {
  const isDesktop = useIsDesktop();
  const camera = useFilePicker({ camera: true, onFiles: (files) => addPhotosToItem(itemId, files) });
  const library = useFilePicker({ multiple: true, onFiles: (files) => addPhotosToItem(itemId, files) });
  return (
    <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-1">
      {camera.input}
      {library.input}
      {!isDesktop && <AddPhotoTile icon={CameraIcon} label="Take photo" onClick={camera.open} />}
      <AddPhotoTile
        icon={ImageIcon}
        label={isDesktop ? "Add photos" : "From library"}
        onClick={library.open}
        className="col-span-1"
      />
    </div>
  );
}
