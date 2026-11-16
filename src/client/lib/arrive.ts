import type { Person } from "@shared/api";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { useCallback } from "react";
import { afterSignIn } from "./after-sign-in";
import { rememberUser, sessionQuery } from "./queries";

/**
 * What a screen does once someone is signed in (a link, an invite): this person's session replaces whatever was here,
 * then `go` moves on to `target` (see afterSignIn) in place of the signing-in page.
 */
export function useArrive(target?: string) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const router = useRouter();
  const stay = useCallback(
    (user: Person) => {
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== "session" });
      queryClient.setQueryData(sessionQuery.queryKey, user);
      rememberUser(user);
    },
    [queryClient],
  );
  const go = useCallback(
    () => navigate({ href: afterSignIn(target, router.options.context.knows), replace: true }),
    [navigate, router, target],
  );
  return { stay, go };
}
