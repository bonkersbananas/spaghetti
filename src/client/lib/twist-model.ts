import { type AttemptFile, ONE_REQUEST_FILE_BYTES, type Twist } from "@shared/api";
import type { QueryClient } from "@tanstack/react-query";
import { toast } from "@/components/ui/Toast";
import { api } from "./api";
import { discardUpload, dropUpload, setUpload } from "./big-upload";
import { keepFile } from "./item-files";
import { twistsQuery } from "./twists-query";

/** The model a twist keeps (decision 0053): saved with the twist, then sliced on this device like an idea's. */

function withModel(
  queryClient: QueryClient,
  twistId: string,
  change: (model: AttemptFile | null) => AttemptFile | null,
) {
  queryClient.setQueryData<Twist[]>(twistsQuery.queryKey, (twists) =>
    twists?.map((twist) => (twist.id === twistId ? { ...twist, model: change(twist.model) } : twist)),
  );
}

/**
 * Keeps a model (an .stl, as "Adapt an STL" makes it) with the twist, in place of the one it kept. It shows on the
 * page at once, the original is sent as it is, and slicing starts beside it with the workshop's defaults
 * (lib/slicing/jobs.ts), whose result follows the original to the server. A refusal takes it off again.
 */
export async function keepTwistModel(queryClient: QueryClient, twistId: string, file: File): Promise<void> {
  const id = crypto.randomUUID();
  const replaced =
    queryClient.getQueryData<Twist[]>(twistsQuery.queryKey)?.find((t) => t.id === twistId)?.model ?? null;
  // A list fetch already on its way would put the old twist back over the new model.
  await queryClient.cancelQueries({ queryKey: twistsQuery.queryKey });
  const shown: AttemptFile & { pending: true } = {
    id,
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
  withModel(queryClient, twistId, () => shown);
  // The old model's slicing and upload stop here; its row stays on the server for the undo.
  if (replaced) cleanUp(replaced);
  // The jobs' code comes with the first model, not with the app.
  const jobs = await import("./slicing/jobs");
  void jobs.startSlice(queryClient, { fileId: id, name: file.name, source: file, target: { twistId } });
  const form = new FormData();
  form.set("name", file.name);
  form.set("size", String(file.size));
  form.set("plate", "1");
  form.set("plateCount", "1");
  form.set("prefill", "{}");
  form.set("kind", "model");
  if (file.size <= ONE_REQUEST_FILE_BYTES) form.set("file", file, file.name);
  const kept = keepFile(`/twists/${twistId}/file/${id}`, file, id, "model", form, {
    // A slice that reached the server first (it waits for this) stays.
    saved: (saved) =>
      withModel(queryClient, twistId, (model) => (model?.id === id ? (model.slice ? model : saved) : model)),
    giveUp: () => {
      jobs.cancelSlice(id);
      withModel(queryClient, twistId, (model) => (model?.id === id ? replaced : model));
      toast.error("Couldn't keep that model", "Check the connection and try again.");
    },
  });
  // Never silent: the model it replaced comes back with one tap (the server makes way for it).
  if (replaced && !("pending" in replaced)) {
    toast.undo("Model replaced", {
      description: replaced.name,
      onUndo: async () => {
        await kept;
        const current = queryClient.getQueryData<Twist[]>(twistsQuery.queryKey)?.find((t) => t.id === twistId)?.model;
        // The save was refused and the old model is already back: there is nothing to undo.
        if (current?.id !== id) return;
        cleanUp(current);
        withModel(queryClient, twistId, () => replaced);
        await api(`/twists/${twistId}/file/${replaced.id}/restore`, { method: "POST" }).catch(() =>
          toast.error("Couldn't bring the model back"),
        );
      },
    });
  }
  await kept;
}

/** What a model leaves behind on this device when it goes: its upload and its slicing. */
function cleanUp(file: AttemptFile) {
  setUpload(file.id, null);
  void dropUpload(file.id);
  if ("pending" in file && file.pending) void discardUpload(file.id);
  if (file.kind === "model") void import("./slicing/jobs").then(({ cancelSlice }) => cancelSlice(file.id));
}

/** Takes the twist's model off at once, with Undo. */
export function removeTwistModel(queryClient: QueryClient, twistId: string, file: AttemptFile) {
  cleanUp(file);
  withModel(queryClient, twistId, () => null);
  const deleted = api(`/twists/${twistId}/file/${file.id}`, { method: "DELETE" }).catch(() => undefined);
  toast.undo("Model removed", {
    description: file.name,
    onUndo: async () => {
      await deleted;
      withModel(queryClient, twistId, () => file);
      await api(`/twists/${twistId}/file/${file.id}/restore`, { method: "POST" }).catch(() =>
        toast.error("Couldn't bring the model back"),
      );
    },
  });
}
