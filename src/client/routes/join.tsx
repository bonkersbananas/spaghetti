import { MIN_PASSWORD_LENGTH, type SessionResponse } from "@shared/api";
import type { PersonColor } from "@shared/people";
import type { CeremonyOptions, InvitePeek, JoinRequest } from "@shared/signing-in";
import type { PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/browser";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useEffect, useState } from "react";
import { AuthPage } from "@/components/shell/AuthPage";
import { Avatar } from "@/components/ui/Avatar";
import { Button, IconButton } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { EyeIcon, EyeSlashIcon, PasskeyIcon } from "@/components/ui/icons";
import { PersonColorPicker } from "@/components/ui/PersonColorPicker";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { ApiError, api } from "@/lib/api";
import { useArrive } from "@/lib/arrive";
import { askForPasskeyAfterSignIn } from "@/lib/passkey-offer";
import { biometric, isCancelled, passkeysSupported, rememberPasskeyHere } from "@/lib/passkeys";
import { signOutSettled } from "@/lib/use-sign-out";

export const Route = createFileRoute("/join")({
  component: JoinPage,
});

/** A username suggested from the name: lowercase letters and digits, as the server wants them. */
const suggest = (name: string) =>
  name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 32);

/**
 * The page an invite opens: a name, a username, a color and a passkey or a password, then the new person is
 * signed in. The invite's secret is after the # (never in a server log) and is taken out of the address bar.
 */
function JoinPage() {
  const arrive = useArrive();
  const navigate = useNavigate();
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [usernameTouched, setUsernameTouched] = useState(false);
  const [color, setColor] = useState<PersonColor>("basil");
  const [method, setMethod] = useState<"passkey" | "password">(passkeysSupported() ? "passkey" : "password");
  const [password, setPassword] = useState("");
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const secret = window.location.hash.slice(1);
    setToken(secret || null);
    if (secret) history.replaceState(null, "", window.location.pathname);
  }, []);

  const peek = useQuery({
    queryKey: ["join", token],
    enabled: !!token,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: () => api<InvitePeek>("/join/peek", { method: "POST", json: { token } }),
  });

  const join = useMutation({
    mutationFn: async () => {
      await signOutSettled();
      const details = { token: token ?? "", name: name.trim(), username, color };
      if (method === "password") {
        return api<SessionResponse>("/join", { method: "POST", json: { ...details, password } satisfies JoinRequest });
      }
      const [{ startRegistration }, { ceremonyId, options }] = await Promise.all([
        import("@simplewebauthn/browser"),
        api<CeremonyOptions<PublicKeyCredentialCreationOptionsJSON>>("/join/options", {
          method: "POST",
          json: details,
        }),
      ]);
      const response = await startRegistration({ optionsJSON: options });
      const session = await api<SessionResponse>("/join", {
        method: "POST",
        json: { ...details, passkey: { ceremonyId, response } } satisfies JoinRequest,
      });
      rememberPasskeyHere();
      return session;
    },
    onSuccess: async ({ user }) => {
      arrive.stay(user);
      if (method === "password") askForPasskeyAfterSignIn();
      await arrive.goToday();
    },
  });

  const error = join.error instanceof ApiError ? join.error : null;
  const cancelled = isCancelled(join.error);
  const usernameError = error?.code === "username_taken" ? error.message : undefined;
  const otherError = error && !usernameError ? error.message : undefined;
  const ready =
    name.trim().length > 0 && username.length >= 2 && (method === "passkey" || password.length >= MIN_PASSWORD_LENGTH);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready || join.isPending) return;
    join.mutate();
  }

  if (token === undefined || (token && peek.isPending)) return <AuthPage lead="One moment…">{null}</AuthPage>;

  if (!token || peek.isError) {
    return (
      <AuthPage lead="This invite has done its job.">
        <p className="text-body text-ink-soft">
          It was already used, withdrawn, or it expired (they last a week). Ask for a new one.
        </p>
        <Button
          variant="primary"
          size="lg"
          fullWidth
          className="mt-6"
          onClick={() => void navigate({ to: "/sign-in" })}
        >
          Go to sign in
        </Button>
      </AuthPage>
    );
  }

  return (
    <AuthPage
      lead={`${peek.data?.invitedBy ?? "Someone"} saved you a seat.`}
      footer={
        <Link to="/sign-in" className="focus-ring decoration-ink-ghost underline underline-offset-4">
          Already have a name here? Sign in
        </Link>
      }
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <TextField
          label="Your name"
          name="name"
          autoComplete="name"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            if (!usernameTouched) setUsername(suggest(event.target.value));
          }}
          autoFocus
        />
        <TextField
          label="Username"
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={username}
          onChange={(event) => {
            setUsernameTouched(true);
            setUsername(event.target.value.toLowerCase());
            if (usernameError) join.reset();
          }}
          error={usernameError}
          hint="What you type to sign in. Lowercase letters and digits."
        />
        <div className="flex items-center gap-3">
          <Avatar person={{ name: name || "?", color }} size="lg" decorative />
          <PersonColorPicker value={color} onChange={setColor} />
        </div>
        {passkeysSupported() && (
          <SegmentedControl
            label="How will you sign in?"
            value={method}
            onChange={setMethod}
            options={[
              { value: "passkey", label: biometric() === "a passkey" ? "Passkey" : biometric(), icon: PasskeyIcon },
              { value: "password", label: "Password" },
            ]}
          />
        )}
        {method === "password" && (
          <div className="relative">
            <TextField
              label="Password"
              name="new-password"
              type={shown ? "text" : "password"}
              autoComplete="new-password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              hint={`At least ${MIN_PASSWORD_LENGTH} characters. A few words is plenty.`}
              className="[&_input]:pr-12"
            />
            <IconButton
              icon={shown ? EyeSlashIcon : EyeIcon}
              label={shown ? "Hide password" : "Show password"}
              size="sm"
              onClick={() => setShown((s) => !s)}
              className="absolute top-7 right-2"
            />
          </div>
        )}
        {(otherError || (join.error && !error && !cancelled)) && (
          <p role="alert" className="text-small text-tomato-ink font-medium">
            {otherError ?? "Can't reach the kitchen. Check the connection and try again."}
          </p>
        )}
        <Button
          type="submit"
          variant="primary"
          size="lg"
          fullWidth
          loading={join.isPending}
          disabled={!ready}
          icon={method === "passkey" ? PasskeyIcon : undefined}
        >
          {method === "passkey" ? `Join with ${biometric()}` : "Join"}
        </Button>
      </form>
    </AuthPage>
  );
}
