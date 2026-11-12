import type { Photo, Twist, TwistResponse } from "@shared/api";
import { modelMarkOf, modelPlace } from "@shared/model-mark";
import type { TwistChange } from "@shared/twists";
import { type QueryClient, useQuery } from "@tanstack/react-query";
import { toast } from "@/components/ui/Toast";
import { ApiError, api } from "./api";
import { patchCachedItem } from "./items";
import { twistsQuery } from "./twists-query";

export { twistsQuery };

export function useTwists() {
  const { data, isPending } = useQuery(twistsQuery);
  return { twists: data, isPending };
}

function patchTwists(queryClient: QueryClient, change: (twists: Twist[]) => Twist[]) {
  queryClient.setQueryData<Twist[]>(twistsQuery.queryKey, (twists) => (twists ? change(twists) : twists));
}

/**
 * A write the screen shows before the server has it. A list fetch already on its way was asked before the write and
 * would put the old list back over it, so it is called off first (the write's own answer refreshes the cache).
 */
function showFirst(queryClient: QueryClient, change: (twists: Twist[]) => Twist[]) {
  void queryClient.cancelQueries({ queryKey: twistsQuery.queryKey });
  queryClient.setQueryData<Twist[]>(twistsQuery.queryKey, (twists) => change(twists ?? []));
}

/** What a twist made from an idea is called until someone renames it: the idea's title, else where the model lives. */
export function suggestedTwistName(idea: { title: string | null }, modelUrl: string | null): string {
  const title = idea.title?.trim();
  if (title) return title;
  const mark = modelUrl ? modelMarkOf(modelUrl) : null;
  return mark ? `A twist on a ${modelPlace(mark)} model` : "A new twist";
}

export interface NewTwist {
  name: string;
  note?: string;
  /** The idea it is made from: the server takes its model link, title and cover along. */
  from?: { id: string; photo: Photo | null; modelUrl: string | null; title: string | null };
  sourceUrl?: string;
}

/**
 * Makes a twist. It shows at once (the list and its page read the cache), the server's copy replaces it, and a failure
 * takes it back out. Returns the new id so the caller can open it.
 */
export function makeTwist(queryClient: QueryClient, input: NewTwist, userId: string, whenSaved?: () => void): string {
  const id = crypto.randomUUID();
  const url = input.sourceUrl ?? input.from?.modelUrl ?? null;
  const mark = url ? modelMarkOf(url) : null;
  const now = Date.now();
  const optimistic: Twist = {
    id,
    name: input.name,
    note: input.note ?? "",
    source: {
      url,
      title: input.from?.title?.trim() || null,
      designer: null,
      license: null,
      place: mark ? modelPlace(mark) : null,
      photo: input.from?.photo ?? null,
    },
    changes: [],
    fromItemId: input.from?.id ?? null,
    recipeId: null,
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
  };
  // The list may not have loaded yet: a twist opened straight away still finds itself.
  showFirst(queryClient, (twists) => [optimistic, ...twists]);
  api<TwistResponse>("/twists", {
    method: "POST",
    json: {
      id,
      name: input.name,
      ...(input.note ? { note: input.note } : {}),
      ...(input.from ? { fromItemId: input.from.id } : {}),
      ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
    },
  }).then(
    ({ twist }) => {
      patchTwists(queryClient, (twists) => twists.map((t) => (t.id === id ? twist : t)));
      // Called-off list fetches may have left the cache with only this twist: ask for the whole list again.
      void queryClient.invalidateQueries({ queryKey: twistsQuery.queryKey });
      whenSaved?.();
    },
    (error) => {
      patchTwists(queryClient, (twists) => twists.filter((t) => t.id !== id));
      toast.error("Couldn't make the twist", error instanceof ApiError ? error.message : "Try again in a moment.");
    },
  );
  return id;
}

export interface TwistChanges {
  name?: string;
  note?: string;
  sourceUrl?: string;
  designer?: string;
  license?: string;
  changes?: TwistChange[];
}

/** Changes a twist; the screen shows the change first and the server's copy replaces it. Resolves once the server has it. */
export async function updateTwist(queryClient: QueryClient, id: string, changes: TwistChanges) {
  showFirst(queryClient, (twists) =>
    twists.map((t) => {
      if (t.id !== id) return t;
      const { sourceUrl, designer, license, ...rest } = changes;
      return {
        ...t,
        ...rest,
        source: {
          ...t.source,
          ...(sourceUrl !== undefined && { url: sourceUrl || null }),
          ...(designer !== undefined && { designer: designer || null }),
          ...(license !== undefined && { license: license || null }),
        },
      };
    }),
  );
  const { twist } = await api<TwistResponse>(`/twists/${id}`, { method: "PATCH", json: changes });
  patchTwists(queryClient, (twists) => twists.map((t) => (t.id === id ? twist : t)));
}

/** Deletes a twist at once, with Undo. */
export function deleteTwist(queryClient: QueryClient, twist: Twist) {
  const before = queryClient.getQueryData<Twist[]>(twistsQuery.queryKey);
  showFirst(queryClient, (twists) => twists.filter((t) => t.id !== twist.id));
  const deleted = api(`/twists/${twist.id}`, { method: "DELETE" }).catch((error) => {
    if (error instanceof ApiError && error.status === 404) return;
    if (before) queryClient.setQueryData(twistsQuery.queryKey, before);
    toast.error("Couldn't delete that twist", "It's back where it was.");
  });
  toast.undo("Twist deleted", {
    description: twist.name,
    onUndo: async () => {
      await deleted;
      patchTwists(queryClient, (twists) => [twist, ...twists.filter((t) => t.id !== twist.id)]);
      try {
        await api<TwistResponse>(`/twists/${twist.id}/restore`, { method: "POST" });
      } catch {
        toast.error("Couldn't bring the twist back", "Try again in a moment.");
      }
    },
  });
}

/**
 * "Save as twist" on a build that was printed from someone else's model: a twist from the build (its model link, title
 * and cover come along) that the build is then marked as printing. Returns the twist's id so its page can open.
 */
export function twistFromBuild(
  queryClient: QueryClient,
  build: { id: string; title: string | null; note: string; photo: Photo | null; modelUrl: string | null },
  userId: string,
): string {
  // The build is linked only once the twist is on the server, and shown linked only once that is saved too: a twist
  // that failed, or a link that did, leaves nothing dangling.
  const id: string = makeTwist(
    queryClient,
    {
      name: suggestedTwistName({ title: build.title }, build.modelUrl),
      from: { id: build.id, photo: build.photo, modelUrl: build.modelUrl, title: build.title },
    },
    userId,
    () => {
      api(`/items/${build.id}`, { method: "PATCH", json: { twistId: id } }).then(
        () => patchCachedItem(queryClient, build.id, (item) => ({ ...item, twistId: id })),
        () => undefined,
      );
    },
  );
  return id;
}
