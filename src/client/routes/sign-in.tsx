import type { SessionResponse } from "@shared/api";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { motion } from "motion/react";
import { type FormEvent, useState } from "react";
import { z } from "zod";
import { Mark } from "@/components/illustrations";
import { Button, IconButton } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { EyeIcon, EyeSlashIcon } from "@/components/ui/icons";
import { ApiError, api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { ease, spring } from "@/lib/motion";
import { sessionQuery } from "@/lib/queries";

export const Route = createFileRoute("/sign-in")({
  validateSearch: z.object({ redirect: z.string().optional() }),
  beforeLoad: async ({ context }) => {
    const user = await context.queryClient.ensureQueryData(sessionQuery);
    if (user) throw redirect({ to: "/ideas" });
  },
  component: SignIn,
});

/** Only same-origin paths, so a crafted link can't send people elsewhere. */
function safeRedirect(target: string | undefined): string {
  return target?.startsWith("/") && !target.startsWith("//") ? target : "/ideas";
}

function SignIn() {
  const { redirect: redirectTo } = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const signIn = useMutation({
    mutationFn: () => api<SessionResponse>("/session", { method: "POST", json: { username, password } }),
    onSuccess: async ({ user }) => {
      queryClient.setQueryData(sessionQuery.queryKey, user);
      await navigate({ href: safeRedirect(redirectTo), replace: true });
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
    <div className="paper-grain bg-paper pt-safe pb-safe relative flex min-h-dvh flex-col items-center px-5">
      <div className="flex w-full max-w-sm flex-1 flex-col justify-center py-10">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: ease.out }}
          className="mb-8 flex flex-col items-center text-center"
        >
          <motion.div
            initial={{ rotate: -90, scale: 0.6 }}
            animate={{ rotate: 0, scale: 1 }}
            transition={{ ...spring.gentle, delay: 0.05 }}
          >
            <Mark className="size-16 drop-shadow-sm md:size-18" />
          </motion.div>
          <h1 className="text-display text-ink mt-5">Spaghetti</h1>
          <p className="text-body text-ink-soft mt-1.5">Our printing notebook. Failures included.</p>
        </motion.div>

        <motion.form
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: ease.out, delay: 0.08 }}
          onSubmit={submit}
          noValidate
          className="bg-cream shadow-raised rounded-xl p-5 md:p-6"
        >
          <div key={attempt} className={cn("flex flex-col gap-4", attempt > 0 && "sg-shake")}>
            <TextField
              label="Name"
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoFocus
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
          <Button type="submit" variant="primary" size="lg" fullWidth loading={signIn.isPending} className="mt-6">
            Sign in
          </Button>
        </motion.form>
      </div>
      <p className="text-small text-ink-faint pb-6 text-center">
        Just the two of us here. No account? Ask the other cook.
      </p>
    </div>
  );
}
