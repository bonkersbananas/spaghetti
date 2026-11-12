import type { SessionResponse } from "@shared/api";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { m } from "motion/react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Mark } from "@/components/illustrations";
import { Button, IconButton } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { EyeIcon, EyeSlashIcon, PasskeyIcon } from "@/components/ui/icons";
import { ApiError, api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { ease, spring } from "@/lib/motion";
import { askForPasskeyAfterSignIn } from "@/lib/passkey-offer";
import { autofillSupported, biometric, isCancelled, passkeysSupported, signInWithPasskey } from "@/lib/passkeys";
import { rememberUser, sessionQuery } from "@/lib/queries";
import { signOutSettled } from "@/lib/use-sign-out";

export const Route = createFileRoute("/sign-in")({
  // By hand, not zod: route search checks load with the app (see share.tsx).
  validateSearch: (search: Record<string, unknown>): { redirect?: string } =>
    typeof search.redirect === "string" ? { redirect: search.redirect } : {},
  beforeLoad: async ({ context }) => {
    const user = await context.queryClient.ensureQueryData(sessionQuery);
    if (user) throw redirect({ to: "/today" });
  },
  component: SignIn,
});

/** Only same-origin paths, so a crafted link can't send people elsewhere. */
function safeRedirect(target: string | undefined): string {
  return target?.startsWith("/") && !target.startsWith("//") ? target : "/today";
}

function SignIn() {
  const { redirect: redirectTo } = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // Where passkeys work, they come first; the password form stays right below, never behind a menu.
  const [passkeys] = useState(passkeysSupported);
  const [passkeyError, setPasskeyError] = useState<string>();

  async function arrive(user: SessionResponse["user"]) {
    // Whatever an earlier session left in memory is not this person's to see.
    queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== "session" });
    queryClient.setQueryData(sessionQuery.queryKey, user);
    rememberUser(user);
    await navigate({ href: safeRedirect(redirectTo), replace: true });
  }

  const withPasskey = useMutation({
    mutationFn: async () => {
      await signOutSettled();
      return signInWithPasskey(false);
    },
    onMutate: () => setPasskeyError(undefined),
    onSuccess: ({ user }) => arrive(user),
    onError: (error) => {
      if (isCancelled(error)) return;
      setPasskeyError(
        error instanceof ApiError ? error.message : "Can't reach the kitchen. Check the connection and try again.",
      );
    },
  });

  // Conditional UI: the browser offers this device's passkeys in the name field, so a tap on one signs in.
  const arriveRef = useRef(arrive);
  arriveRef.current = arrive;
  useEffect(() => {
    let live = true;
    void autofillSupported().then(async (supported) => {
      if (!supported || !live) return;
      try {
        await signOutSettled();
        const { user } = await signInWithPasskey(true);
        if (live) await arriveRef.current(user);
      } catch {
        // Closed, replaced by the button's own ceremony, or nothing to offer: the form still works.
      }
    });
    return () => {
      live = false;
    };
  }, []);

  const signIn = useMutation({
    mutationFn: async () => {
      // A sign-out still on its way must not end the session this one starts.
      await signOutSettled();
      return api<SessionResponse>("/session", { method: "POST", json: { username, password } });
    },
    onSuccess: async ({ user }) => {
      askForPasskeyAfterSignIn();
      await arrive(user);
    },
    onError: () => setAttempt((n) => n + 1),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!username || !password || signIn.isPending) return;
    signIn.mutate();
  }

  const error =
    signIn.error instanceof ApiError
      ? signIn.error.message
      : signIn.error
        ? "Can't reach the kitchen. Check the connection and try again."
        : undefined;

  return (
    <main className="paper-grain bg-paper pt-safe pb-safe relative flex min-h-dvh flex-col items-center px-5">
      <div className="flex w-full max-w-sm flex-1 flex-col pt-[clamp(2.5rem,12dvh,7rem)] pb-10">
        <m.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: ease.out }}
          className="mb-8 flex flex-col items-center text-center"
        >
          <m.div
            initial={{ rotate: -90, scale: 0.6 }}
            animate={{ rotate: 0, scale: 1 }}
            transition={{ ...spring.gentle, delay: 0.05 }}
          >
            <Mark className="size-16 drop-shadow-sm md:size-18" />
          </m.div>
          <h1 className="text-display text-ink mt-5">Spaghetti</h1>
          <p className="text-body text-ink-soft mt-1.5">Our printing notebook. Failures included.</p>
        </m.div>

        <m.form
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: ease.out, delay: 0.08 }}
          onSubmit={submit}
          noValidate
          className="bg-cream shadow-raised rounded-xl p-5 md:p-6"
        >
          {passkeys && (
            <>
              <Button
                type="button"
                variant="primary"
                size="lg"
                fullWidth
                icon={PasskeyIcon}
                loading={withPasskey.isPending}
                onClick={() => withPasskey.mutate()}
              >
                Sign in with {biometric()}
              </Button>
              {passkeyError && (
                <p role="alert" className="text-small text-tomato-ink mt-3 text-center font-medium">
                  {passkeyError}
                </p>
              )}
              <p className="text-small text-ink-faint my-4 flex items-center gap-3 text-center">
                <span className="bg-hairline h-px flex-1" aria-hidden />
                or with your name and password
                <span className="bg-hairline h-px flex-1" aria-hidden />
              </p>
            </>
          )}
          <div key={attempt} className={cn("flex flex-col gap-4", attempt > 0 && "sg-shake")}>
            <TextField
              label="Name"
              name="username"
              autoComplete="username webauthn"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoFocus={!passkeys}
            />
            <div className="relative">
              <TextField
                label="Password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="[&_input]:pr-12"
              />
              <IconButton
                icon={showPassword ? EyeSlashIcon : EyeIcon}
                label={showPassword ? "Hide password" : "Show password"}
                size="sm"
                onClick={() => setShowPassword((s) => !s)}
                className="absolute right-2 bottom-2 md:bottom-1.5"
              />
            </div>
          </div>
          {error && (
            <p role="alert" className="text-small text-tomato-ink mt-3 font-medium">
              {error}
            </p>
          )}
          <Button
            type="submit"
            variant={passkeys ? "secondary" : "primary"}
            size="lg"
            fullWidth
            loading={signIn.isPending}
            className="mt-6"
          >
            Sign in
          </Button>
        </m.form>
        <p className="text-small text-ink-faint mt-6 text-center text-balance">
          Just the two of us here. No account? Ask the other cook.
          <br />
          <Link
            to="/link"
            className="focus-ring touch-target decoration-ink-ghost relative inline-block py-2 underline underline-offset-4"
          >
            Signing in from another device? Use a code
          </Link>
        </p>
      </div>
    </main>
  );
}
