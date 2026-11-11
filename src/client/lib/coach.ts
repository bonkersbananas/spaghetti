import type { AttemptResponse } from "@shared/api";
import type { QueryClient } from "@tanstack/react-query";
import { toast } from "@/components/ui/Toast";
import { api } from "./api";
import { patchCachedItem } from "./items";
import { canEdit } from "./read-only";

/** Marks one of Claude's suggestions for the next try as dismissed (or takes that back), optimistically. */
export async function setCoachDismissed(
  queryClient: QueryClient,
  itemId: string,
  attemptId: string,
  suggestionId: string,
  dismissed: boolean,
) {
  if (!canEdit()) return;
  const mark = (value: boolean) =>
    patchCachedItem(queryClient, itemId, (item) => ({
      ...item,
      attempts: item.attempts.map((attempt) =>
        attempt.id === attemptId && attempt.coach
          ? {
              ...attempt,
              coach: {
                ...attempt.coach,
                items: attempt.coach.items.map((entry) =>
                  entry.id === suggestionId ? { ...entry, dismissed: value } : entry,
                ),
              },
            }
          : attempt,
      ),
    }));
  mark(dismissed);
  if (dismissed) {
    toast.undo("Suggestion dismissed", {
      onUndo: () => void setCoachDismissed(queryClient, itemId, attemptId, suggestionId, false),
    });
  }
  try {
    await api<AttemptResponse>(`/attempts/${attemptId}/coach/${suggestionId}`, {
      method: "PUT",
      json: { dismissed },
      keepalive: true,
    });
  } catch {
    mark(!dismissed);
    toast.error("Couldn't save that", "It's back the way it was. Try again in a moment.");
  }
}
