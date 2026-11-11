import { SCOPE_INFO } from "@shared/agents";
import type { AuthorizeRequestInfo } from "@shared/oauth";
import { displayName } from "@shared/people";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { AuthPage } from "@/components/shell/AuthPage";
import { Button } from "@/components/ui/Button";
import { CheckIcon } from "@/components/ui/icons";
import { Overline } from "@/components/ui/Overline";
import { Skeleton } from "@/components/ui/Skeleton";
import { ApiError, api } from "@/lib/api";
import { sessionQuery } from "@/lib/queries";

/** What an app puts in the address when it sends someone here (RFC 6749 and 7636). */
const PARAMS = [
  "response_type",
  "client_id",
  "redirect_uri",
  "code_challenge",
  "code_challenge_method",
  "scope",
  "state",
  "resource",
] as const;

export const Route = createFileRoute("/authorize")({
  // By hand, not zod: route search checks load with the app (see share.tsx).
  validateSearch: (search: Record<string, unknown>): Record<string, string> =>
    Object.fromEntries(
      PARAMS.filter((key) => typeof search[key] === "string").map((key) => [key, search[key] as string]),
    ),
  // Signed out: the app's own sign-in (password or passkey), then straight back here with the request intact.
  beforeLoad: async ({ context, location }) => {
    const user = await context.queryClient.ensureQueryData(sessionQuery);
    if (!user) throw redirect({ to: "/sign-in", search: { redirect: location.href }, replace: true });
  },
  component: Authorize,
});

/** Belt and braces beside the frame headers (public/_headers): a framed consent screen shows nothing to click. */
const framed = typeof window !== "undefined" && window.top !== window.self;

function Authorize() {
  const params = Route.useSearch();
  const { data: user } = useQuery(sessionQuery);
  const query = useQuery({
    queryKey: ["oauth-request", params],
    queryFn: () => api<AuthorizeRequestInfo>(`/oauth/request?${new URLSearchParams(params)}`),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });

  const decide = useMutation({
    mutationFn: async (approve: boolean) => {
      const { redirectTo } = await api<{ redirectTo: string }>("/oauth/decision", {
        method: "POST",
        json: { ...params, approve },
      });
      return { redirectTo, approve };
    },
    // Back to the app: it takes the code (or the "no") from the address. The buttons stay busy until the page goes.
    onSuccess: ({ redirectTo }) => window.location.assign(redirectTo),
  });

  const footer = (
    <>
      Disconnect an app any time from{" "}
      <Link
        to="/agents"
        className="focus-ring touch-target decoration-ink-ghost relative inline-block py-2 underline underline-offset-4"
      >
        Agents
      </Link>
      .
    </>
  );

  if (query.isError) {
    const message =
      query.error instanceof ApiError
        ? query.error.message
        : "Can't reach the kitchen. Check the connection and try again.";
    return (
      <AuthPage lead="Connect an app" footer={footer}>
        <h2 className="text-title text-ink">That link doesn't look right</h2>
        <p role="alert" className="text-body text-ink-soft mt-2">
          {message} Start the connection again from the app.
        </p>
        <Button
          variant="secondary"
          size="lg"
          fullWidth
          className="mt-6"
          onClick={() => (window.history.length > 1 ? window.history.back() : window.location.assign("/today"))}
        >
          Back
        </Button>
      </AuthPage>
    );
  }

  if (framed) return null;
  const info = query.data;
  const me = displayName(user, "you");
  return (
    <AuthPage lead="Connect an app" footer={footer}>
      {info ? (
        <>
          <div className="flex items-center gap-3.5">
            <span
              aria-hidden
              className="bg-ink/6 text-ink font-display text-title inline-flex size-12 shrink-0 items-center justify-center rounded-md font-semibold select-none"
            >
              {info.app.charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0">
              <h2 className="text-title text-ink break-words">{info.app} wants to connect</h2>
              <p className="text-small text-ink-faint break-words">Then it returns you to {info.returnsTo}</p>
            </div>
          </div>
          <p className="text-body text-ink-soft mt-4">
            It will work as you, {me}. Everything it does shows up as “via {info.app} for {me}”.
          </p>
          <Overline as="h3" className="mt-5 block">
            It will be able to
          </Overline>
          <ul className="mt-2.5 flex flex-col gap-2.5">
            {info.scopes.map((scope) => (
              <li key={scope} className="flex gap-2.5">
                <CheckIcon weight="bold" className="text-basil-ink mt-0.5 shrink-0" size={18} aria-hidden />
                <span className="text-body text-ink-soft">
                  <span className="text-ink font-semibold">{SCOPE_INFO[scope].label}.</span> {SCOPE_INFO[scope].hint}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-small text-ink-faint mt-4">It can't delete anything: that stays with the two of you.</p>
          {decide.isError && (
            <p role="alert" className="text-small text-tomato-ink mt-3 font-medium">
              {decide.error instanceof ApiError ? decide.error.message : "Can't reach the kitchen. Try again."}
            </p>
          )}
          <div className="mt-6 flex flex-col gap-2.5">
            <Button
              variant="primary"
              size="lg"
              fullWidth
              loading={decide.isPending && decide.variables === true}
              disabled={decide.isPending}
              onClick={() => decide.mutate(true)}
            >
              Allow
            </Button>
            <Button
              variant="quiet"
              size="lg"
              fullWidth
              disabled={decide.isPending}
              onClick={() => decide.mutate(false)}
            >
              Not now
            </Button>
          </div>
        </>
      ) : (
        <div aria-hidden className="flex flex-col gap-4">
          <div className="flex items-center gap-3.5">
            <Skeleton className="size-12 rounded-md" />
            <Skeleton className="h-6 w-48" />
          </div>
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}
    </AuthPage>
  );
}
