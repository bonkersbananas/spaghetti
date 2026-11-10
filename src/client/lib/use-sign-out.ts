import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { api } from "./api";
import { clearOfflineData } from "./offline";
import { thisDeviceEndpoint } from "./push";
import { rememberUser, sessionQuery } from "./queries";

/** The server-side sign-out still on its way; signing in again waits for it, so it can't end the new session. */
let signingOut: Promise<unknown> = Promise.resolve();
export const signOutSettled = () => signingOut;

/** Signs out at once: the device forgets everything and shows sign-in while the server ends the session. */
export function useSignOut() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useCallback(async () => {
    // keepalive: the request still reaches the server if the page goes away (a reload) first.
    // This device stops getting notifications for the person who leaves it; the server forgets it with the session.
    const pushEndpoint = await thisDeviceEndpoint();
    signingOut = api("/session", {
      method: "DELETE",
      keepalive: true,
      ...(pushEndpoint ? { json: { pushEndpoint } } : {}),
    }).catch(() => undefined);
    rememberUser(null);
    await clearOfflineData();
    queryClient.setQueryData(sessionQuery.queryKey, null);
    queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== "session" });
    await navigate({ to: "/sign-in" });
  }, [queryClient, navigate]);
}
