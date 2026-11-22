/**
 * Who started a print from the printer (decision 0076), on this device: the caches change at once and the server
 * follows; a failure puts it back. The toast's Undo says it again as it was. Only people say it: the printer can't
 * know, and pairing the bridge doesn't make anyone's prints.
 */
import type { AttemptResponse } from "@shared/api";
import type { QueryClient } from "@tanstack/react-query";
import { toast } from "@/components/ui/Toast";
import { api } from "./api";
import { patchCachedItem } from "./items";
import { canEdit } from "./read-only";

function setInCaches(queryClient: QueryClient, itemId: string, attemptId: string, who: string | null) {
  patchCachedItem(queryClient, itemId, (cached) => ({
    ...cached,
    attempts: cached.attempts.map((one) => (one.id === attemptId ? { ...one, startedBy: who } : one)),
  }));
}

const send = (attemptId: string, who: string | null) =>
  api<AttemptResponse>(`/attempts/${attemptId}/started-by`, { method: "PUT", json: { startedBy: who } });

interface StartedByChange {
  itemId: string;
  attemptId: string;
  /** Who it said before (null: nobody), for Undo. */
  before: string | null;
  who: string | null;
  /** The toast's words: "Started by Marie", "Started by you", "Just the printer's". */
  said: string;
}

/** Says who started a print from the printer, with an Undo. */
export function sayWhoStarted(queryClient: QueryClient, { itemId, attemptId, before, who, said }: StartedByChange) {
  if (!canEdit() || before === who) return;
  setInCaches(queryClient, itemId, attemptId, who);
  const sent = send(attemptId, who).then(
    () => true,
    () => {
      setInCaches(queryClient, itemId, attemptId, before);
      toast.error("Couldn't save that", "Try again in a moment.");
      return false;
    },
  );
  toast.undo(said, {
    onUndo: async () => {
      if (!(await sent)) return;
      setInCaches(queryClient, itemId, attemptId, before);
      await send(attemptId, before).catch(() => {
        setInCaches(queryClient, itemId, attemptId, who);
        toast.error("Couldn't undo that", "Try again in a moment.");
      });
    },
  });
}
