import type { PushConfig } from "@shared/push";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { NotificationOffer } from "@/components/ui/NotificationOffer";
import { toast } from "@/components/ui/Toast";
import { api } from "@/lib/api";
import { pushQuery, usePushDevice } from "@/lib/push-device";

/**
 * Offers notifications to a person who has none on any device, once, until they say "Not now" (kept on the
 * server, so no other device asks again). Only where this device can subscribe: not iPhone Safari outside the Home
 * Screen app, an old browser, a blocked permission or a server without a push key. Its code is its own chunk, as only
 * a person without push sees it.
 */
export default function NotificationsOffer() {
  const queryClient = useQueryClient();
  const device = usePushDevice();
  const dismiss = useMutation({
    mutationFn: () => api("/push/offer/dismiss", { method: "POST" }),
    onMutate: () =>
      queryClient.setQueryData(pushQuery.queryKey, (data?: PushConfig) => data && { ...data, offerDismissed: true }),
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: pushQuery.queryKey });
      toast.error("Couldn't save that", "Check the connection and try again.");
    },
  });
  const { config } = device;
  if (device.status !== "off" || !config?.publicKey || config.offerDismissed || config.subscriptions.length > 0) {
    return null;
  }
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
