import { fromBase64Url } from "@shared/base64url";
import type { PushConfig, PushSubscriptionBody } from "@shared/push";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "./api";
import { browserSubscription, isApple, isInstalled, supported, timeZone } from "./push";

export const pushQuery = queryOptions({ queryKey: ["push"], queryFn: () => api<PushConfig>("/push") });

export type PushStatus =
  /** Checking what this browser can do. */
  | "loading"
  /** No web push here (an old browser, or a private window). */
  | "unsupported"
  /** iPhone and iPad only have it for an app added to the Home Screen. */
  | "install"
  /** The person said no in the browser: only its settings can change that. */
  | "blocked"
  | "off"
  | "on";

function body(subscription: PushSubscription, alsoOthers?: boolean): PushSubscriptionBody {
  const json = subscription.toJSON();
  return {
    endpoint: subscription.endpoint,
    keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" },
    timeZone: timeZone(),
    ...(alsoOthers === undefined ? {} : { alsoOthers }),
  };
}

/**
 * This device's notification settings: what the browser allows, whether it is subscribed, and the person's
 * choices. Permission is only ever asked for in `turnOn`, which a tap on the switch calls.
 */
export function usePushDevice(enabled = true) {
  const queryClient = useQueryClient();
  const config = useQuery({ ...pushQuery, enabled });
  const [subscription, setSubscription] = useState<PushSubscription | null | undefined>(undefined);
  const [permission, setPermission] = useState<NotificationPermission | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if (!supported()) {
      setSubscription(null);
      return;
    }
    setPermission(Notification.permission);
    let alive = true;
    // A dev server has no service worker, so there is nothing to subscribe through.
    navigator.serviceWorker.getRegistration().then(async (registration) => {
      const found = registration ? await browserSubscription().catch(() => null) : null;
      if (alive) setSubscription(found);
    });
    return () => {
      alive = false;
    };
  }, [enabled]);

  const mine = config.data?.subscriptions.find((s) => s.endpoint === subscription?.endpoint);

  // Travelling: tell the server when this device's time zone changed, so quiet hours follow.
  useEffect(() => {
    if (mine && subscription && mine.timeZone !== timeZone()) {
      void api("/push/subscription", {
        method: "PATCH",
        json: { endpoint: subscription.endpoint, timeZone: timeZone() },
      });
    }
  }, [mine, subscription]);

  let status: PushStatus = "loading";
  if (subscription !== undefined && config.data) {
    if (!supported()) status = isApple() && !isInstalled() ? "install" : "unsupported";
    else if (mine && subscription) status = "on";
    else if (permission === "denied") status = "blocked";
    else status = "off";
  }

  const refresh = () => queryClient.invalidateQueries({ queryKey: pushQuery.queryKey });

  const turnOn = useMutation({
    mutationFn: async () => {
      const publicKey = config.data?.publicKey;
      if (!publicKey) throw new Error("This server has no push key.");
      const result =
        Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
      setPermission(result);
      if (result !== "granted") return null;
      const registration = await navigator.serviceWorker.ready;
      const made =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: fromBase64Url(publicKey),
        }));
      await api("/push/subscription", { method: "PUT", json: body(made) });
      setSubscription(made);
      return made;
    },
    onSettled: refresh,
  });

  const turnOff = useMutation({
    mutationFn: async () => {
      if (!subscription) return;
      const endpoint = subscription.endpoint;
      await api("/push/subscription", { method: "DELETE", json: { endpoint } });
      await subscription.unsubscribe().catch(() => false);
      setSubscription(null);
    },
    onSettled: refresh,
  });

  const setAlsoOthers = useMutation({
    mutationFn: (alsoOthers: boolean) =>
      api("/push/subscription", { method: "PATCH", json: { endpoint: subscription?.endpoint, alsoOthers } }),
    // The switch moves at once; a failure puts it back.
    onMutate: async (alsoOthers) => {
      await queryClient.cancelQueries({ queryKey: pushQuery.queryKey });
      const before = queryClient.getQueryData(pushQuery.queryKey);
      queryClient.setQueryData(
        pushQuery.queryKey,
        (data?: PushConfig) =>
          data && {
            ...data,
            subscriptions: data.subscriptions.map((s) =>
              s.endpoint === subscription?.endpoint ? { ...s, alsoOthers } : s,
            ),
          },
      );
      return { before };
    },
    onError: (_error, _value, context) => queryClient.setQueryData(pushQuery.queryKey, context?.before),
    onSettled: refresh,
  });

  const sendTest = useMutation({
    mutationFn: () => api("/push/test", { method: "POST", json: { endpoint: subscription?.endpoint } }),
  });

  return {
    status,
    permission,
    config: config.data,
    alsoOthers: mine?.alsoOthers ?? false,
    turnOn,
    turnOff,
    setAlsoOthers,
    sendTest,
  };
}
