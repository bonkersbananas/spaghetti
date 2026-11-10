import type { CreateUpkeepRequest, UpdateUpkeepRequest, UpkeepLog, UpkeepResponse, UpkeepTask } from "@shared/api";
import { DRYING_DAYS } from "@shared/drying";
import { type QueryClient, queryOptions, useQuery } from "@tanstack/react-query";
import { toast } from "@/components/ui/Toast";
import { ApiError, api } from "./api";
import { processPhoto } from "./images";
import { usePrinterSetup } from "./pantry";
import { setPreview } from "./previews";

/** The printer's upkeep tasks, most due first, and its print hours. */
export const upkeepQuery = queryOptions({
  queryKey: ["upkeep"] as const,
  queryFn: () => api<UpkeepResponse>("/printer/upkeep"),
  staleTime: 60_000,
});

/** The days each material stays dry: the starting values with this printer's own laid over. */
export function useDryingDays(): Record<string, number> {
  const overrides = usePrinterSetup().dryingDays;
  return overrides ? { ...DRYING_DAYS, ...overrides } : { ...DRYING_DAYS };
}

/** The tasks that are due (what Today's line and the Printer page's count read). */
export function useDueUpkeep(): UpkeepTask[] {
  return (useQuery(upkeepQuery).data?.tasks ?? []).filter((task) => task.due);
}

function patchUpkeep(queryClient: QueryClient, change: (data: UpkeepResponse) => UpkeepResponse) {
  queryClient.setQueryData<UpkeepResponse>(upkeepQuery.queryKey, (data) => (data ? change(data) : data));
}
const byDue = (a: UpkeepTask, b: UpkeepTask) => b.fraction - a.fraction;

/** Marks a task done at once (it resets, and moves down the list), then tells the server; a note and a photo ride along. */
export async function logUpkeep(
  queryClient: QueryClient,
  task: UpkeepTask,
  by: string,
  options: { note?: string; photo?: File | null } = {},
) {
  const logId = crypto.randomUUID();
  const before = queryClient.getQueryData<UpkeepResponse>(upkeepQuery.queryKey);
  const log: UpkeepLog = {
    id: logId,
    taskId: task.id,
    doneBy: by,
    via: null,
    doneAt: Date.now(),
    printerHours: before ? before.printHours : 0,
    note: options.note?.trim() ?? "",
    photo: null,
  };
  patchUpkeep(queryClient, (data) => ({
    ...data,
    tasks: data.tasks
      .map((entry) =>
        entry.id === task.id
          ? {
              ...entry,
              sinceHours: 0,
              sinceDays: 0,
              fraction: 0,
              due: false,
              lastDone: log,
              history: [log, ...entry.history].slice(0, 5),
            }
          : entry,
      )
      .sort(byDue),
  }));
  try {
    const saved = await api<UpkeepResponse>(`/printer/upkeep/${task.id}/done`, {
      method: "POST",
      json: { id: logId, note: log.note || undefined },
    });
    queryClient.setQueryData(upkeepQuery.queryKey, saved);
  } catch (error) {
    if (before) queryClient.setQueryData(upkeepQuery.queryKey, before);
    toast.error("Couldn't save that", error instanceof ApiError ? error.message : "Try again in a moment.");
    return;
  }
  if (options.photo) await addLogPhoto(queryClient, logId, options.photo);
  toast.undo(`${task.name}: done`, {
    onUndo: async () => {
      try {
        await api(`/printer/upkeep/logs/${logId}`, { method: "DELETE" });
      } catch {
        toast.error("Couldn't take that back", "Try again in a moment.");
      }
      void queryClient.invalidateQueries({ queryKey: upkeepQuery.queryKey });
    },
  });
}

async function addLogPhoto(queryClient: QueryClient, logId: string, file: File) {
  try {
    const processed = await processPhoto(file);
    const photoId = crypto.randomUUID();
    setPreview(photoId, processed.thumb, processed.large);
    const form = new FormData();
    form.set("width", String(processed.width));
    form.set("height", String(processed.height));
    form.set("color", processed.color);
    form.set("large", processed.large, "large");
    form.set("thumb", processed.thumb, "thumb");
    const saved = await api<UpkeepResponse>(`/printer/upkeep/logs/${logId}/photo/${photoId}`, {
      method: "PUT",
      body: form,
    });
    queryClient.setQueryData(upkeepQuery.queryKey, saved);
  } catch (error) {
    toast.error("Couldn't save the photo", error instanceof Error ? error.message : undefined);
  }
}

/** Changes a task's name, note or interval; shown at once. */
export async function updateUpkeep(queryClient: QueryClient, taskId: string, changes: UpdateUpkeepRequest) {
  const before = queryClient.getQueryData<UpkeepResponse>(upkeepQuery.queryKey);
  patchUpkeep(queryClient, (data) => ({
    ...data,
    tasks: data.tasks.map((task) => (task.id === taskId ? { ...task, ...changes } : task)),
  }));
  try {
    queryClient.setQueryData(
      upkeepQuery.queryKey,
      await api<UpkeepResponse>(`/printer/upkeep/${taskId}`, { method: "PATCH", json: changes, keepalive: true }),
    );
  } catch (error) {
    if (before) queryClient.setQueryData(upkeepQuery.queryKey, before);
    toast.error("Couldn't save that", error instanceof ApiError ? error.message : "Try again in a moment.");
  }
}

/** Adds a task of their own. */
export async function addUpkeep(queryClient: QueryClient, request: Omit<CreateUpkeepRequest, "id">) {
  try {
    queryClient.setQueryData(
      upkeepQuery.queryKey,
      await api<UpkeepResponse>("/printer/upkeep", { method: "POST", json: { id: crypto.randomUUID(), ...request } }),
    );
  } catch (error) {
    toast.error("Couldn't add that", error instanceof ApiError ? error.message : "Try again in a moment.");
  }
}

/** Takes a task off the list at once, with Undo. */
export function deleteUpkeep(queryClient: QueryClient, task: UpkeepTask) {
  const before = queryClient.getQueryData<UpkeepResponse>(upkeepQuery.queryKey);
  patchUpkeep(queryClient, (data) => ({ ...data, tasks: data.tasks.filter((entry) => entry.id !== task.id) }));
  const deleted = api(`/printer/upkeep/${task.id}`, { method: "DELETE" }).catch((error) => {
    if (error instanceof ApiError && error.status === 404) return;
    if (before) queryClient.setQueryData(upkeepQuery.queryKey, before);
    toast.error("Couldn't remove that", "It's back on the list.");
  });
  toast.undo("Task removed", {
    description: task.name,
    onUndo: async () => {
      await deleted;
      try {
        queryClient.setQueryData(
          upkeepQuery.queryKey,
          await api<UpkeepResponse>(`/printer/upkeep/${task.id}/restore`, { method: "POST" }),
        );
      } catch {
        toast.error("Couldn't bring it back", "Try again in a moment.");
      }
    },
  });
}
