import { toast as sonnerToast } from "sonner";

/**
 * Toasts that belong to one idea or build (the draft's "Drafted from MakerWorld · Undo"), so the next step on that
 * same thing can put them away: starting to build it shouldn't leave the draft's undo sitting on top of "Started
 * building" and the Log attempt bar. A plain module (no lazy code), so builds.ts can use it.
 */
const byItem = new Map<string, Set<string | number>>();

export function rememberItemToast(itemId: string, id: string | number) {
  const ids = byItem.get(itemId) ?? new Set();
  ids.add(id);
  byItem.set(itemId, ids);
}

export function dismissItemToasts(itemId: string) {
  for (const id of byItem.get(itemId) ?? []) sonnerToast.dismiss(id);
  byItem.delete(itemId);
}
