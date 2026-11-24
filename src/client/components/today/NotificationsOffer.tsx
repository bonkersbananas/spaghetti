import type { PushConfig } from "@shared/push";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { NotificationOffer } from "@/components/ui/NotificationOffer";
import { toast } from "@/components/ui/Toast";
import { api } from "@/lib/api";
import { pushQuery, usePushDevice } from "@/lib/push-device";
import { OFFER_HINT } from "./offer-hint";

/**
 * Offers notifications to a person who has none on any device, once, until they say "Not now" (kept on the
 * server, so no other device asks again). Only where this device can subscribe: not iPhone Safari outside the Home
 * Screen app, an old browser, a blocked permission or a server without a push key. Its code is its own chunk, as only
 * a person without push sees it.
 *
 * It never moves what is already on the screen: the first time this device finds the offer applies, it only
 * remembers that (OFFER_HINT) and shows it from the next visit, when the gate has kept its place from the first paint.
 */
export default function NotificationsOffer({ show, onResolved }: { show: boolean; onResolved: () => void }) {
  const queryClient = useQueryClient();
  const device = usePushDevice();
  const dismiss = useMutation({
    mutationFn: () => api("/push/offer", { method: "PUT", json: { dismissed: true } }),
    onMutate: () =>
      queryClient.setQueryData(pushQuery.queryKey, (data?: PushConfig) => data && { ...data, offerDismissed: true }),
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: pushQuery.queryKey });
      toast.error("Couldn't save that", "Check the connection and try again.");
    },
  });
  const { config } = device;
  const known = device.status !== "loading" && !!config;
  const applies =
    device.status === "off" && !!config?.publicKey && !config.offerDismissed && config.subscriptions.length === 0;
  useEffect(() => {
    if (!known) return;
    try {
      if (applies) localStorage.setItem(OFFER_HINT, "1");
      else localStorage.removeItem(OFFER_HINT);
    } catch {
      // Storage blocked: the offer just never shows.
    }
    onResolved();
  }, [known, applies, onResolved]);
  if (!applies || !show) return null;
  return (
    <NotificationOffer
      busy={device.turnOn.isPending}
      onDismiss={() => dismiss.mutate()}
      onTurnOn={() =>
        device.turnOn.mutate(undefined, {
          onSuccess: (made) => made && toast.success("Notifications are on"),
          onError: () => toast.error("Couldn't turn notifications on", "Check the connection and try again."),
        })
      }
    />
  );
}
