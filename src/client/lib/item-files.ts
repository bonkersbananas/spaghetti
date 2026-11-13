import { type AttemptFile, type ItemFileResponse, MAX_SLICER_FILE_BYTES, ONE_REQUEST_FILE_BYTES } from "@shared/api";
import type { FileKind } from "@shared/slicing/types.ts";
import type { QueryClient } from "@tanstack/react-query";
import { toast } from "@/components/ui/Toast";
import { api } from "./api";
import { dropUpload, isRefusal, setUpload, uploadInParts } from "./big-upload";
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
  if (draft.file.size <= ONE_REQUEST_FILE_BYTES) form.set("file", draft.file, draft.file.name);
  return { form, plate, prefill };
}

/**
 * Saves a file's row, its bytes first in parts when it is big. A big file that doesn't get through stays on its card,
 * which says so and offers another go (its bytes are in this tab); a small one, or a refused one, is given up on at
 * once. Calls `saved` with the row, or `giveUp`.
 */
function keepItemFile(
  itemId: string,
  file: File,
  id: string,
  kind: FileKind,
  form: FormData,
  after: { saved: (row: AttemptFile) => void; giveUp: () => void },
) {
  // Over the cap a slicer file keeps only what it said: there are no bytes to send.
  const big = file.size > ONE_REQUEST_FILE_BYTES && file.size <= MAX_SLICER_FILE_BYTES;
  if (big) form.set("uploaded", "1");
  const attempt = async () => {
    try {
      if (big) {
        setUpload(id, { fraction: 0, failed: false });
        await uploadInParts({
          id,
          part: "file",
          kind,
          name: file.name,
          blob: file,
          onProgress: (fraction) => setUpload(id, { fraction, failed: false }),
        });
      }
      const { file: row } = await api<ItemFileResponse>(`/items/${itemId}/files/${id}`, {
        method: "PUT",
        body: form,
        keepalive: false,
      });
      setUpload(id, null);
      after.saved(row);
    } catch (error) {
      if (big && !isRefusal(error)) {
        setUpload(id, { fraction: 0, failed: true, retry: () => void attempt() });
        return;
      }
      setUpload(id, null);
      after.giveUp();
    }
  };
  return attempt();
}

/**
 * Reads a picked or dropped file and keeps it with the item. It shows on the page at once; a refusal takes it off
 * again with a word about why. Needs a connection (offline, saved things are read-only).
 */
export async function addItemFile(queryClient: QueryClient, itemId: string, file: File): Promise<void> {
  const draft = await readSlicerFile(file);
  if (!draft) return;
  if (draft.kind === "model") return addItemModel(queryClient, itemId, draft);
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
  await keepItemFile(itemId, file, draft.id, "slicer", form, {
    saved: (saved) => withFiles(queryClient, itemId, (files) => files.map((f) => (f.id === saved.id ? saved : f))),
    giveUp: () => {
      withFiles(queryClient, itemId, (files) => files.filter((f) => f.id !== draft.id));
      toast.error("Couldn't keep that file", "Check the connection and try again.");
    },
  });
}

/**
 * A model (.stl or plain .3mf) kept with the item: the original is sent at once, as it is, and slicing starts beside
 * it on this device (lib/slicing/jobs.ts), whose result follows the original to the server. The card shows both.
 */
async function addItemModel(queryClient: QueryClient, itemId: string, draft: SlicerFileDraft) {
  const { file } = draft;
  const shown: AttemptFile & { pending: true } = {
    id: draft.id,
    name: file.name,
    size: file.size,
    stored: true,
    hasThumb: false,
    plate: 1,
    plateCount: 1,
    slicer: null,
    prefill: {},
    objects: [],
    kind: "model",
    slice: null,
    createdAt: Date.now(),
    pending: true,
  };
  withFiles(queryClient, itemId, (files) => [...files, shown]);
  // The jobs' code comes with the first model, not with the app.
  const jobs = await import("./slicing/jobs");
  void jobs.startSlice(queryClient, {
    fileId: draft.id,
    name: file.name,
    source: file,
    target: { itemId, attemptId: null },
  });
  const form = new FormData();
  form.set("name", file.name);
  form.set("size", String(file.size));
  form.set("plate", "1");
  form.set("plateCount", "1");
  form.set("prefill", "{}");
  form.set("kind", "model");
  if (file.size <= ONE_REQUEST_FILE_BYTES) form.set("file", file, file.name);
  await keepItemFile(itemId, file, draft.id, "model", form, {
    // A slice that reached the server first (it waits for this) stays.
    saved: (saved) =>
      withFiles(queryClient, itemId, (files) => files.map((f) => (f.id === saved.id ? (f.slice ? f : saved) : f))),
    giveUp: () => {
      jobs.cancelSlice(draft.id);
      withFiles(queryClient, itemId, (files) => files.filter((f) => f.id !== draft.id));
      toast.error("Couldn't keep that model", "Check the connection and try again.");
    },
  });
}

/** Takes a file off at once, with Undo. */
export function removeItemFile(queryClient: QueryClient, itemId: string, file: AttemptFile) {
  // A big file still on its way (or stuck) is let go of, with what the server holds of it.
  setUpload(file.id, null);
  void dropUpload(file.id);
  withFiles(queryClient, itemId, (files) => files.filter((f) => f.id !== file.id));
  // A model still slicing stops: brought back, it offers "Slice it".
  if (file.kind === "model") void import("./slicing/jobs").then(({ cancelSlice }) => cancelSlice(file.id));
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
