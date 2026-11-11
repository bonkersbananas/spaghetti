import type { ItemResponse, Part } from "@shared/api";
import { cleanPartName, MAX_PART_QUANTITY, MAX_PARTS } from "@shared/parts";
import type { QueryClient } from "@tanstack/react-query";
import { toast } from "@/components/ui/Toast";
import { api } from "./api";
import { cachedItem, patchCachedItem } from "./items";
import { canEdit } from "./read-only";

/** What can be sent about a part: the id and name are always there, a photo only when it changes. */
export interface PartDraft {
  id: string;
  name: string;
  quantity: number;
  photoId?: string | null;
}

/** Parts are optional and small: the editor is a quiet row, never a form. */
export { MAX_PART_QUANTITY, MAX_PARTS };

const sorted = (parts: Part[]) =>
  [...parts].sort((a, b) => a.position - b.position || a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));

/** Adds or changes parts at once (the cache), then on the server; a failure puts the list back. */
export async function saveParts(queryClient: QueryClient, itemId: string, drafts: PartDraft[]) {
  const before = cachedItem(queryClient, itemId)?.parts ?? [];
  const now = Date.now();
  let next = before.reduce((last, part) => Math.max(last, part.position + 1), 0);
  const known = new Map(before.map((part) => [part.id, part]));
  const clean = drafts.map((draft) => ({ ...draft, name: cleanPartName(draft.name) })).filter((draft) => draft.name);
  if (!clean.length) return;
  patchCachedItem(queryClient, itemId, (item) => {
    const byId = new Map(item.parts.map((part) => [part.id, part]));
    for (const draft of clean) {
      const existing = byId.get(draft.id);
      byId.set(draft.id, {
        id: draft.id,
        itemId,
        name: draft.name,
        quantity: draft.quantity,
        position: existing?.position ?? known.get(draft.id)?.position ?? next++,
        photoId: draft.photoId === undefined ? (existing?.photoId ?? null) : draft.photoId,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });
    }
    return { ...item, parts: sorted([...byId.values()]) };
  });
  try {
    const { item: saved } = await api<ItemResponse>(`/items/${itemId}/parts`, {
      method: "PUT",
      json: {
        parts: clean.map((draft) => ({
          id: draft.id,
          name: draft.name,
          quantity: draft.quantity,
          ...(draft.photoId !== undefined ? { photoId: draft.photoId } : {}),
        })),
      },
      keepalive: true,
    });
    // Positions the server chose; the rest stays as typed here.
    patchCachedItem(queryClient, itemId, (item) => ({
      ...item,
      parts: sorted(item.parts.map((part) => saved.parts.find((s) => s.id === part.id) ?? part)),
    }));
  } catch (error) {
    patchCachedItem(queryClient, itemId, (item) => ({ ...item, parts: before }));
    toast.error("Couldn't save that part", "It's back the way it was. Try again in a moment.");
    throw error;
  }
}

/** Removes a part at once, with Undo (which puts it back under the same id and place). */
export function removePart(queryClient: QueryClient, itemId: string, part: Part) {
  if (!canEdit()) return;
  patchCachedItem(queryClient, itemId, (item) => ({ ...item, parts: item.parts.filter((p) => p.id !== part.id) }));
  const removed = api(`/items/${itemId}/parts/${part.id}`, { method: "DELETE" }).then(
    () => true,
    () => {
      patchCachedItem(queryClient, itemId, (item) => ({ ...item, parts: sorted([...item.parts, part]) }));
      toast.error(`Couldn't remove ${part.name}`, "It's back where it was.");
      return false;
    },
  );
  toast.undo(`${part.name} removed`, {
    description: "Attempts that printed it keep their counts.",
    onUndo: async () => {
      if (!(await removed)) return;
      patchCachedItem(queryClient, itemId, (item) => ({ ...item, parts: sorted([...item.parts, part]) }));
      try {
        await api<ItemResponse>(`/items/${itemId}/parts`, {
          method: "PUT",
          json: {
            parts: [
              {
                id: part.id,
                name: part.name,
                quantity: part.quantity,
                position: part.position,
                photoId: part.photoId,
              },
            ],
          },
        });
      } catch {
        toast.error("Couldn't bring the part back", "Try again in a moment.");
        patchCachedItem(queryClient, itemId, (item) => ({
          ...item,
          parts: item.parts.filter((p) => p.id !== part.id),
        }));
      }
    },
  });
}

/** A new part's place: after the ones there. */
export const nextPosition = (parts: readonly Part[]) =>
  parts.reduce((last, part) => Math.max(last, part.position + 1), 0);
