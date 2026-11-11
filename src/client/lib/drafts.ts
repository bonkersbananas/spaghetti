import type { DraftResponse, FeaturesResponse, Item } from "@shared/api";
import type { ItemDraft } from "@shared/draft";
import { firstModelLink, lonelyModelLink } from "@shared/model-links";
import { type QueryClient, queryOptions, useQuery } from "@tanstack/react-query";
import { toast } from "@/components/ui/Toast";
import { api } from "./api";
import { cachedItem, itemKeys, patchCachedItem } from "./items";

/** What the Worker can do beyond the basics; today only whether Claude can draft ideas (it has its key). */
export const featuresQuery = queryOptions({
  queryKey: ["features"],
  queryFn: () => api<FeaturesResponse>("/features"),
  staleTime: Number.POSITIVE_INFINITY,
  retry: false,
});

/** Whether anything about drafting should show at all: without the Worker's key nothing does. */
export const useDraftsEnabled = () => useQuery(featuresQuery).data?.drafts === true;

/** Drafts being asked for right now on this device, so a tap or a capture can't ask twice. */
const asking = new Set<string>();
/** Drafts that already said so with a toast, so a second poll doesn't say it again. */
const announced = new Set<string>();

const refreshItem = (queryClient: QueryClient, id: string) => {
  void queryClient.invalidateQueries({ queryKey: itemKeys.detail(id) });
  void queryClient.invalidateQueries({ queryKey: [itemKeys.all[0], "list"] });
  // The note's link card takes the page's title from the draft.
  void queryClient.invalidateQueries({ queryKey: ["link-preview"] });
};

/**
 * Asks Claude to draft the idea from its model link. The idea shows "reading the page" at once; the request stays
 * open until the draft is done (an Opus call outlasts what a Worker may do after answering), and the other
 * person sees the result through the change feed. A request that is lost leaves the job on the server, which
 * the cron finishes.
 */
export async function requestDraft(
  queryClient: QueryClient,
  item: Pick<Item, "id" | "note">,
  url?: string,
  /** The title that came with a share and may be replaced by the draft's. */
  sharedTitle?: string | null,
) {
  const found = url ? firstModelLink(url) : firstModelLink(item.note);
  if (!found || asking.has(item.id)) return;
  asking.add(item.id);
  const reading: ItemDraft = {
    status: "reading",
    site: found.site.id,
    url: found.url,
    failure: null,
    applied: [],
    title: null,
    note: null,
    findings: null,
    draftedAt: null,
  };
  patchCachedItem(queryClient, item.id, (cached) => ({ ...cached, draft: reading }));
  try {
    const { draft } = await api<DraftResponse>(`/items/${item.id}/draft`, {
      method: "POST",
      json: { url: found.url, ...(sharedTitle ? { sharedTitle } : {}) },
    });
    patchCachedItem(queryClient, item.id, (cached) => ({ ...cached, draft }));
  } catch {
    // Lost on the way: the server's copy of the job is the truth, and the next refresh shows it.
  } finally {
    asking.delete(item.id);
    refreshItem(queryClient, item.id);
  }
}

/** Starts a draft by itself when a freshly saved capture is only a model link (and nothing else was written). */
export async function draftSavedCapture(queryClient: QueryClient, item: Item, sharedTitle: string | null = null) {
  // A title that came with the share (the page's own) doesn't count as written by the person.
  const typedTitle = !!item.title?.trim() && item.title !== sharedTitle;
  if (item.stage !== "idea" || typedTitle || item.draft || !lonelyModelLink(item.note)) return;
  try {
    const features = await queryClient.fetchQuery(featuresQuery);
    if (features.drafts) await requestDraft(queryClient, item, undefined, sharedTitle);
  } catch {
    // Offline or signed out: nothing to draft with.
  }
}

/** The undo toast for a draft that filled the idea in: once per draft, on whichever device has the idea open. */
export function announceDraft(queryClient: QueryClient, item: Pick<Item, "id" | "draft">) {
  const draft = item.draft;
  if (draft?.status !== "drafted" || !draft.applied.length || announced.has(item.id)) return;
  announced.add(item.id);
  toast.undo(`Drafted from ${siteName(draft)}`, { onUndo: () => void undoDraft(queryClient, item.id) });
}

/** "Get the pictures" on a drafted idea that has none: the Worker tries the page's pictures again. */
export async function getPictures(queryClient: QueryClient, id: string) {
  try {
    const { stored = 0 } = await api<DraftResponse>(`/items/${id}/draft/pictures`, { method: "POST" });
    if (!stored) toast.message("No pictures came from that page");
  } catch {
    toast.error("Couldn't get the pictures");
  }
  refreshItem(queryClient, id);
}

/** Takes a draft back (the Worker only removes what is still exactly what it wrote). */
export async function undoDraft(queryClient: QueryClient, id: string) {
  const before = cachedItem(queryClient, id);
  patchCachedItem(queryClient, id, (cached) => ({ ...cached, draft: null }));
  try {
    await api<DraftResponse>(`/items/${id}/draft`, { method: "DELETE" });
  } catch {
    if (before) patchCachedItem(queryClient, id, () => before);
    toast.error("Couldn't take that back");
  }
  refreshItem(queryClient, id);
}

const SITE_NAMES = { makerworld: "MakerWorld", printables: "Printables", thingiverse: "Thingiverse" } as const;
export const siteName = (draft: Pick<ItemDraft, "site">) => SITE_NAMES[draft.site];
