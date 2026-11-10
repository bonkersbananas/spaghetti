import type { NotificationPlatform } from "@shared/push";
import { useCallback, useEffect } from "react";

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

/** The service worker talks to the open app: "go to this attempt" (a tapped notification) and "the outbox changed". */
export function useServiceWorkerMessages(navigate: (path: string) => void, pickUpOutbox: () => void) {
  const stable = useCallback(
    (event: MessageEvent) => {
      if (event.data?.type === "navigate" && typeof event.data.url === "string" && event.data.url.startsWith("/")) {
        navigate(event.data.url);
      } else if (event.data?.type === "outbox-changed") {
        pickUpOutbox();
      }
    },
    [navigate, pickUpOutbox],
  );
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.addEventListener("message", stable);
    return () => navigator.serviceWorker.removeEventListener("message", stable);
  }, [stable]);
}
