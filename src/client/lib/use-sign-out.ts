import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { api } from "./api";
import { clearOfflineData } from "./offline";
import { browserSubscription, thisDeviceEndpoint } from "./push";
import { rememberUser, sessionQuery } from "./queries";

/** The server-side sign-out still on its way; signing in again waits for it, so it can't end the new session. */
let signingOut: Promise<unknown> = Promise.resolve();
export const signOutSettled = () => signingOut;

/** True from the moment someone taps Sign out until sign-in is showing: the shell must not treat that as an ended session. */
let leaving = false;
export const isSigningOut = () => leaving;

/**
 * A session the server ended (from another device, a changed password) leaves this browser's own HTTP cache: photos
 * are kept there a year and served without asking. Only an answer from the server can empty it, the sign-out's
 * `Clear-Site-Data: "cache"`, so the device asks for one; it also drops the dead cookie. Signing in again waits for it.
 */
export function forgetEndedSession() {
  signingOut = api("/session", { method: "DELETE", keepalive: true }).catch(() => undefined);
}

/** Signs out at once: the device forgets everything and shows sign-in while the server ends the session. */
export function useSignOut() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useCallback(async () => {
    // keepalive: the request still reaches the server if the page goes away (a reload) first.
    // This device stops getting notifications for the person who leaves it; the server forgets it with the session.
    leaving = true;
    const pushEndpoint = await thisDeviceEndpoint();
    signingOut = api("/session", {
      method: "DELETE",
      keepalive: true,
      ...(pushEndpoint ? { json: { pushEndpoint } } : {}),
    }).catch(() => undefined);
    // The browser lets go of it too, so a subscription left on a device always means "on here" (resyncPush).
    if (pushEndpoint)
      await browserSubscription()
        .then((s) => s?.unsubscribe())
        .catch(() => undefined);
    rememberUser(null);
    await clearOfflineData();
    queryClient.setQueryData(sessionQuery.queryKey, null);
    queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== "session" });
    await navigate({ to: "/sign-in" });
    leaving = false;
  }, [queryClient, navigate]);
}
