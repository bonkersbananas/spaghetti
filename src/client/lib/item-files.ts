import { type AttemptFile, type ItemFileResponse, MAX_SLICER_FILE_BYTES } from "@shared/api";
import type { QueryClient } from "@tanstack/react-query";
import { toast } from "@/components/ui/Toast";
import { api } from "./api";
import { patchCachedItem } from "./items";
import { setPreview } from "./previews";
import { fileSettings, plateOf, plateThumb, readSlicerFile, type SlicerFileDraft } from "./slicer-files";

/** Slicer files kept with an idea (and on its build): picked or dropped, read in the browser, then sent. */

const withFiles = (queryClient: QueryClient, itemId: string, change: (files: AttemptFile[]) => AttemptFile[]) =>
  patchCachedItem(queryClient, itemId, (item) => ({ ...item, files: change(item.files ?? []) }));

/** The multipart body of PUT /api/items/:id/files/:fileId: the same fields as an attempt's file. */
function bodyOf(draft: SlicerFileDraft) {
  const plate = draft.plates[0];
  const form = new FormData();
  const prefill = fileSettings(draft, plate?.index ?? null);
  form.set("name", draft.file.name);
  form.set("size", String(draft.file.size));
  form.set("plate", String(plate?.index ?? 1));
  form.set("plateCount", String(Math.max(draft.result.plates.length, 1)));
  if (draft.slicer) form.set("slicer", draft.slicer);
  form.set("prefill", JSON.stringify(prefill));
  const objects = (plate?.objects ?? []).map((object) => object.name);
  if (objects.length) form.set("objects", JSON.stringify(objects));
  const thumb = plateThumb(plateOf(draft, plate?.index ?? null));
  if (thumb) form.set("thumb", thumb, "thumb.png");
  if (draft.file.size <= MAX_SLICER_FILE_BYTES) form.set("file", draft.file, draft.file.name);
  return { form, plate, prefill };
}

/**
 * Reads a picked or dropped file and keeps it with the item. It shows on the page at once; a refusal takes it off
 * again with a word about why. Needs a connection (offline, saved things are read-only).
 */
export async function addItemFile(queryClient: QueryClient, itemId: string, file: File): Promise<void> {
  const draft = await readSlicerFile(file);
  if (!draft) return;
  const { form, plate, prefill } = bodyOf(draft);
  // The plate's picture shows at once, from this device.
  const thumb = form.get("thumb");
  if (thumb instanceof Blob) setPreview(draft.id, thumb, thumb);
  const shown: AttemptFile & { pending: true } = {
    id: draft.id,
    name: file.name,
    size: file.size,
    stored: file.size <= MAX_SLICER_FILE_BYTES,
    hasThumb: thumb instanceof Blob,
    plate: plate?.index ?? 1,
    plateCount: Math.max(draft.result.plates.length, 1),
    slicer: draft.slicer ?? null,
    prefill,
    objects: [],
    createdAt: Date.now(),
    pending: true,
  };
  withFiles(queryClient, itemId, (files) => [...files, shown]);
  try {
    const { file: saved } = await api<ItemFileResponse>(`/items/${itemId}/files/${draft.id}`, {
      method: "PUT",
      body: form,
      keepalive: false,
    });
    withFiles(queryClient, itemId, (files) => files.map((f) => (f.id === saved.id ? saved : f)));
  } catch {
    withFiles(queryClient, itemId, (files) => files.filter((f) => f.id !== draft.id));
    toast.error("Couldn't keep that file", "Check the connection and try again.");
  }
}

/** Takes a file off at once, with Undo. */
export function removeItemFile(queryClient: QueryClient, itemId: string, file: AttemptFile) {
  withFiles(queryClient, itemId, (files) => files.filter((f) => f.id !== file.id));
  const deleted = api(`/items/${itemId}/files/${file.id}`, { method: "DELETE" }).catch(() => undefined);
  toast.undo("File removed", {
    description: file.name,
    onUndo: async () => {
      await deleted;
      withFiles(queryClient, itemId, (files) => [...files, file].sort((a, b) => a.createdAt - b.createdAt));
      await api(`/items/${itemId}/files/${file.id}/restore`, { method: "POST" }).catch(() =>
        toast.error("Couldn't bring the file back"),
      );
    },
  });
}
