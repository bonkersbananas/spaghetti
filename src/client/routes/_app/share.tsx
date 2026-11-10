import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { z } from "zod";
import { EmptyPot } from "@/components/illustrations";
import { EmptyState } from "@/components/ui/EmptyState";
import { toast } from "@/components/ui/Toast";
import { useCapture } from "@/lib/capture";
import { clearShare, readShare } from "@/lib/share";

const search = z.object({
  /** A share the service worker kept (the share target); also the new idea's id. */
  id: z.uuid().optional().catch(undefined),
  /** Or the words themselves (the bookmarklet, a link, a browser without the service worker). */
  title: z.string().optional().catch(undefined),
  text: z.string().optional().catch(undefined),
  url: z.string().optional().catch(undefined),
});

export const Route = createFileRoute("/_app/share")({
  validateSearch: search,
  component: Share,
});

/** Shares already taken in this page, so a double effect (StrictMode) doesn't capture twice. */
const taken = new Set<string>();

/**
 * Where "Share to Spaghetti" lands: the share target's POST (handled by the service worker), the bookmarklet and
 * links to /share?url=… . It saves the idea at once and hands over to the "Captured" sheet on the inbox.
 */
function Share() {
  const params = Route.useSearch();
  const navigate = useNavigate();
  const { shareIn } = useCapture();

  useEffect(() => {
    const key = params.id ?? JSON.stringify([params.title, params.text, params.url]);
    if (taken.has(key)) return;
    taken.add(key);
    void (async () => {
      const kept = params.id ? await readShare(params.id).catch(() => null) : null;
      const input = kept ?? { title: params.title, text: params.text, url: params.url, files: [] };
      const id = shareIn({ ...input, id: params.id });
      if (params.id) void clearShare(params.id);
      // A reload of a share already taken has nothing left to say: the idea is saved.
      if (!id && (kept || !params.id))
        toast.message("Nothing came through", "That share had no link, text or photo in it.");
      void navigate({ to: "/ideas", replace: true });
    })();
  }, [params, shareIn, navigate]);

  return (
    <>
      <h1 className="sr-only">Sharing to Spaghetti</h1>
      <EmptyState className="py-10 md:py-20" illustration={<EmptyPot />} title="Catching it…">
        Putting what you shared in the pot.
      </EmptyState>
    </>
  );
}
