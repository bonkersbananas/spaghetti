import type { DeletedAttempt, DeletedItem, DeletedResponse, ItemResponse } from "@shared/api";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { toast } from "@/components/ui/Toast";
import { api } from "./api";
import { itemKeys } from "./items";

/** Ideas, builds and attempts deleted in the last 30 days, newest first. */
export const deletedQuery = queryOptions({
  queryKey: ["deleted"] as const,
  queryFn: async () => await api<DeletedResponse>("/deleted"),
  // A fresh look every time the page opens: what was deleted a moment ago must be there.
  staleTime: 0,
});

type Listed = DeletedResponse;

function without(queryClient: QueryClient, drop: (list: Listed) => Listed) {
  queryClient.setQueryData<Listed>(deletedQuery.queryKey, (list) => (list ? drop(list) : list));
}

/** Brings a deleted idea or build back (with its photos and attempts), at once in the list. */
export async function restoreDeletedItem(queryClient: QueryClient, entry: DeletedItem, view: () => void) {
  without(queryClient, (list) => ({ ...list, items: list.items.filter((item) => item.id !== entry.id) }));
  try {
    await api<ItemResponse>(`/items/${entry.id}/restore`, { method: "POST" });
    void queryClient.invalidateQueries({ queryKey: itemKeys.all });
    toast.action(
      entry.stage === "idea" ? "Idea restored" : "Build restored",
      { label: "View", onClick: view },
      entry.title ?? undefined,
    );
  } catch {
    toast.error("Couldn't bring it back", "It may be gone for good.");
    void queryClient.invalidateQueries({ queryKey: deletedQuery.queryKey });
  }
}

/** Brings a deleted attempt back onto its build. */
export async function restoreDeletedAttempt(queryClient: QueryClient, entry: DeletedAttempt, view: () => void) {
  without(queryClient, (list) => ({ ...list, attempts: list.attempts.filter((attempt) => attempt.id !== entry.id) }));
  try {
    await api(`/attempts/${entry.id}/restore`, { method: "POST" });
    void queryClient.invalidateQueries({ queryKey: itemKeys.all });
    toast.action("Attempt restored", { label: "View", onClick: view }, entry.itemTitle ?? undefined);
  } catch {
    toast.error("Couldn't bring it back", "It may be gone for good.");
    void queryClient.invalidateQueries({ queryKey: deletedQuery.queryKey });
  }
}
