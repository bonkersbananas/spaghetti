import type { Item, ItemResponse } from "@shared/api";
import type { CommentsResponse } from "@shared/comments";
import { movedText, withMoved, withoutMoved } from "@shared/move";
import type { QueryClient } from "@tanstack/react-query";
import { toast } from "@/components/ui/Toast";
import { ApiError, api } from "./api";
import { type ItemView, insertCachedItem, patchCachedItem } from "./items";
import { canEdit } from "./read-only";
import { forgetItem, itemName } from "./recent";

/** Why an idea can't be moved into a build right now, or null when it can. */
export function whyNotMove(queryClient: QueryClient, item: ItemView): string | null {
  if (item.stage !== "idea") return "Only an idea that hasn't been started moves.";
  if (item.pending || item.photos.some((photo) => photo.upload))
    return "It is still on its way. Try again in a moment.";
  const talked = queryClient.getQueryData<CommentsResponse>(["comments", item.id])?.comments.length;
  if (talked || item.reactions?.length) return "It has comments or reactions, which stay with the idea.";
  return null;
}

interface Target {
  /** The build. */
  item: ItemView;
  /** One of its attempts, or null for the build itself. */
  attemptId: string | null;
}

/**
 * "Tidy up later": the idea's photos (time and order kept) and note go into a build or one of its attempts, the
 * note after what is there. The caches change at once; the server follows, and a failure puts everything back.
 * One toast undoes it all, or goes to where it went.
 */
export function moveIntoBuild(
  queryClient: QueryClient,
  idea: ItemView,
  target: Target,
  go: (itemId: string) => void,
): boolean {
  if (!canEdit(idea.pending)) return false;
  const { item: build, attemptId } = target;
  const attempt = attemptId ? build.attempts.find((a) => a.id === attemptId) : undefined;
  const ideaBefore = idea as Item;
  const buildBefore = build as Item;
  const added = movedText(idea);
  const places = idea.photos.map((photo) => ({ id: photo.id, position: photo.position }));
  const base = build.photos.reduce((max, photo) => Math.max(max, photo.position), -1) + 1;
  const moved = idea.photos.map((photo, index) => ({
    ...photo,
    itemId: build.id,
    attemptId,
    position: base + index,
    upload: undefined,
  }));
  const ids = new Set(moved.map((photo) => photo.id));

  patchCachedItem(queryClient, build.id, (cached) => ({
    ...cached,
    photos: [...cached.photos, ...moved],
    note: attempt ? cached.note : withMoved(cached.note, added),
    attempts: attempt
      ? cached.attempts.map((a) => (a.id === attempt.id ? { ...a, note: withMoved(a.note, added) } : a))
      : cached.attempts,
  }));
  patchCachedItem(queryClient, idea.id, () => null);
  forgetItem(idea.id);

  const putBack = () => {
    patchCachedItem(queryClient, build.id, (cached) => ({
      ...cached,
      photos: cached.photos.filter((photo) => !ids.has(photo.id)),
      note: attempt ? cached.note : withoutMoved(cached.note, added),
      attempts: attempt
        ? cached.attempts.map((a) => (a.id === attempt.id ? { ...a, note: withoutMoved(a.note, added) } : a))
        : cached.attempts,
    }));
    insertCachedItem(queryClient, ideaBefore);
  };

  const sent = api<ItemResponse>(`/items/${idea.id}/move`, {
    method: "POST",
    json: { targetId: build.id, attemptId },
  }).then(
    ({ item }) => {
      insertCachedItem(queryClient, item);
      return true;
    },
    (error) => {
      if (error instanceof ApiError && error.status === 409 && error.code === "has_comments") {
        toast.error("It stays in Ideas", "An idea with comments or reactions can't move.");
      } else {
        toast.error("Couldn't move that", "It's back where it was.");
      }
      putBack();
      insertCachedItem(queryClient, buildBefore);
      return false;
    },
  );

  const where = attempt ? `${itemName(build, "build")}, attempt ${attempt.number}` : itemName(build, "build");
  toast.undo(`Moved to ${where}`, {
    view: { label: "View", onClick: () => go(build.id) },
    onUndo: async () => {
      if (!(await sent)) return;
      putBack();
      try {
        const { item } = await api<ItemResponse>(`/items/${idea.id}/unmove`, {
          method: "POST",
          json: { targetId: build.id, attemptId, photos: places, note: idea.note },
        });
        insertCachedItem(queryClient, item);
      } catch {
        toast.error("Couldn't bring it back", "Try again in a moment.");
      }
      void queryClient.invalidateQueries({ queryKey: ["items"] });
    },
  });
  return true;
}
