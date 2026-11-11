import type { AttemptHit } from "@shared/api";
import { carryOver } from "@shared/attempts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/Button";
import { PlayIcon } from "@/components/ui/icons";
import { toast } from "@/components/ui/Toast";
import { api } from "@/lib/api";
import { logAttempt } from "@/lib/builds";
import { itemKeys } from "@/lib/items";
import { outbox } from "@/lib/outbox";
import { sessionQuery } from "@/lib/queries";

/**
 * "Start again": a new attempt on the same build with the settings of one that worked, in one tap. It is logged
 * as printing (the way the sheet's Start does), the build opens on it, and Undo takes it back.
 */
export function StartAgain({ hit, onStart }: { hit: AttemptHit; onStart?: () => void }) {
  const { data: me } = useQuery(sessionQuery);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const title = hit.item.title?.trim() || "this build";
  return (
    <Button
      variant="secondary"
      size="sm"
      icon={PlayIcon}
      disabled={!me}
      aria-label={`Start again with the settings of ${title}, attempt ${hit.number}`}
      onClick={() => {
        if (!me) return;
        onStart?.();
        const id = logAttempt(
          hit.item,
          {
            outcome: null,
            printedAt: Date.now(),
            note: "",
            failureTags: [],
            successNotes: [],
            settings: carryOver(hit.attempt.settings),
            parts: [],
            photos: [],
          },
          me.id,
        );
        toast.undo("Started again", {
          description: `${title}, from attempt ${hit.number}'s settings.`,
          onUndo: () => {
            if (outbox.removeAttempt(id)) return;
            void api(`/attempts/${id}`, { method: "DELETE" }).finally(() =>
              queryClient.invalidateQueries({ queryKey: itemKeys.detail(hit.item.id) }),
            );
          },
        });
        void navigate({ to: "/builds/$buildId", params: { buildId: hit.item.id }, search: { attempt: id } });
      }}
    >
      Start again
    </Button>
  );
}
