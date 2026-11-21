import { type Share, type ShareKind, type ShareResponse, type SharesResponse, sharePath } from "@shared/shares";
import type { QueryClient } from "@tanstack/react-query";
import { toast } from "@/components/ui/Toast";
import { ApiError, api } from "./api";
import { sharesQuery } from "./share-query";

/**
 * Making, stopping and bringing back public links (decision 0075). Loaded with the share panel only. Stopping is
 * optimistic and offers Undo, which brings back the very same address; making waits for the server, which picks the
 * token (a tap shows "Making a link…" at once).
 */

/** The address a guest opens. */
export const publicUrl = (token: string) => `${window.location.origin}${sharePath(token)}`;

/** The page's own address on the app's origin, without a photo or tab picked in the query: for the two people. */
export const privateUrl = () => `${window.location.origin}${window.location.pathname}`;

const PATHS: Record<ShareKind, string> = { item: "items", twist: "twists" };

function put(queryClient: QueryClient, share: Share) {
  queryClient.setQueryData<SharesResponse>(sharesQuery.queryKey, (data) => ({
    shares: [share, ...(data?.shares ?? []).filter((s) => s.id !== share.id && s.targetId !== share.targetId)],
  }));
}

function drop(queryClient: QueryClient, id: string) {
  queryClient.setQueryData<SharesResponse>(sharesQuery.queryKey, (data) =>
    data ? { shares: data.shares.filter((share) => share.id !== id) } : data,
  );
}

/** Makes the thing's public link (or finds the one it has) and keeps it in the cache. */
export async function makePublic(queryClient: QueryClient, kind: ShareKind, targetId: string): Promise<Share | null> {
  try {
    const { share } = await api<ShareResponse>(`/shares/${PATHS[kind]}/${targetId}`, { method: "PUT" });
    put(queryClient, share);
    return share;
  } catch (error) {
    toast.error(
      "Couldn't make the link",
      error instanceof ApiError && error.status !== 409 ? error.message : "Try again in a moment.",
    );
    return null;
  }
}

/** Stops a link at once; the toast's Undo brings back the same address. */
export function stopSharing(queryClient: QueryClient, share: Share) {
  drop(queryClient, share.id);
  const stopped = api(`/shares/${share.id}`, { method: "DELETE" }).catch(() => {
    put(queryClient, share);
    toast.error("Couldn't stop sharing", "The link still works. Try again in a moment.");
    throw new Error("not stopped");
  });
  toast.undo("Stopped sharing", {
    description: "The link shows nothing now.",
    onUndo: () => {
      put(queryClient, share);
      void stopped
        .then(() => api<ShareResponse>(`/shares/${share.id}/restore`, { method: "POST" }))
        .then(({ share: back }) => put(queryClient, back))
        .catch((error: unknown) => {
          if (error instanceof Error && error.message === "not stopped") return;
          drop(queryClient, share.id);
          void queryClient.invalidateQueries({ queryKey: sharesQuery.queryKey });
          toast.error(
            "Couldn't bring the link back",
            error instanceof ApiError && error.status === 409 ? error.message : "Try again in a moment.",
          );
        });
    },
  });
}

/** Copies a link and says so; false when the browser wouldn't. */
export async function copyLink(url: string, what: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(url);
    toast.success("Link copied", what);
    return true;
  } catch {
    toast.error("Couldn't copy the link", "Try again in a moment.");
    return false;
  }
}

/** The system share sheet (phones); copying when there is none. Closing the sheet is not an error. */
export async function shareLink(url: string, title: string, what: string) {
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ title: title || "Spaghetti", url });
      return;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
    }
  }
  await copyLink(url, what);
}
