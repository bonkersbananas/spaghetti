import { useCallback, useEffect } from "react";

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
