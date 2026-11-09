import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { api } from "./api";
import { clearOfflineData } from "./offline";
import { rememberUser, sessionQuery } from "./queries";

export function useSignOut() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useCallback(async () => {
    await api("/session", { method: "DELETE" }).catch(() => undefined);
    rememberUser(null);
    await clearOfflineData();
    queryClient.setQueryData(sessionQuery.queryKey, null);
    queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== "session" });
    await navigate({ to: "/sign-in" });
  }, [queryClient, navigate]);
}
