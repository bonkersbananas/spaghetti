import type { AttemptFile } from "@shared/api";
import { useQueryClient } from "@tanstack/react-query";
import { SavedFileCard } from "@/components/builds/SlicerFile";
import { Overline } from "@/components/ui/Overline";
import { removeItemFile } from "@/lib/item-files";

/**
 * The slicer files kept with an idea (and its build): the plate picture, name, size and estimate, Download, the 3D
 * view on a sliced one, and Remove (with Undo). Loaded only once there is a file to show.
 */
export default function ItemFiles({
  itemId,
  files,
  readOnly,
}: {
  itemId: string;
  files: AttemptFile[];
  readOnly?: boolean;
}) {
  const queryClient = useQueryClient();
  if (!files.length) return null;
  return (
    <section aria-labelledby={`files-${itemId}`} className="my-1 flex flex-col gap-2">
      <Overline as="h2" id={`files-${itemId}`} count={files.length}>
        Files
      </Overline>
      <ul className="flex flex-col gap-2">
        {files.map((file) => (
          <li key={file.id}>
            <SavedFileCard
              file={file}
              onRemove={
                readOnly || (file as { pending?: boolean }).pending
                  ? undefined
                  : () => removeItemFile(queryClient, itemId, file)
              }
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
