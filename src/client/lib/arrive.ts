import type { Person } from "@shared/api";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { rememberUser, sessionQuery } from "./queries";

/** What a screen does once someone is signed in (a link, an invite): this person's session replaces whatever was here. */
export function useArrive() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const stay = useCallback(
    (user: Person) => {
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== "session" });
      queryClient.setQueryData(sessionQuery.queryKey, user);
      rememberUser(user);
    },
    [queryClient],
  );
  const goToday = useCallback(() => navigate({ to: "/today", replace: true }), [navigate]);
  return { stay, goToday };
}
