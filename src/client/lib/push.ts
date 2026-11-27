import type { NotificationPlatform, PushConfig, PushSubscriptionBody } from "@shared/push";
import { api } from "./api";

export const supported = () =>
  typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

export function notificationPlatform(): NotificationPlatform {
  if (typeof navigator === "undefined") return "desktop";
  if (isApple()) return "ios";
  return /Android/.test(navigator.userAgent) ? "android" : "desktop";
}

export const isApple = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
export const isInstalled = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  (navigator as { standalone?: boolean }).standalone === true;

export const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export async function browserSubscription(): Promise<PushSubscription | null> {
  if (!supported()) return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

/** The endpoint of this device's subscription, for telling the server on sign-out which device is leaving. */
export async function thisDeviceEndpoint(): Promise<string | null> {
  try {
    if (!supported() || Notification.permission !== "granted") return null;
    // A worker that isn't there (a dev server) would make `ready` wait for ever.
    if (!(await navigator.serviceWorker.getRegistration())) return null;
    return (await browserSubscription())?.endpoint ?? null;
  } catch {
    return null;
  }
}

/**
 * A device whose browser is still subscribed but that the server no longer knows (iOS renewed the subscription, the
 * push service once said it was gone, an older sign-out forgot it) gets nothing and says nothing: the person only
 * notices when the other one's comments stop arriving. On each start, such a device signs itself up again. A device
 * turned off, or signed out, has no subscription left (both unsubscribe), so this never turns anything back on.
 */
export async function resyncPush(): Promise<void> {
  if (!(await thisDeviceEndpoint())) return;
  const subscription = await browserSubscription();
  if (!subscription) return;
  const config = await api<PushConfig>("/push");
  if (!config.publicKey || config.subscriptions.some((s) => s.endpoint === subscription.endpoint)) return;
  const keys = subscription.toJSON().keys;
  if (!keys?.p256dh || !keys.auth) return;
  await api("/push/subscription", {
    method: "PUT",
    json: {
      endpoint: subscription.endpoint,
      keys: { p256dh: keys.p256dh, auth: keys.auth },
      timeZone: timeZone(),
    } satisfies PushSubscriptionBody,
  });
}
