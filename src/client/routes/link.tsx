import type { Person, SessionResponse } from "@shared/api";
import { formatCode } from "@shared/signing-in";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useEffect, useState } from "react";
import { AuthPage } from "@/components/shell/AuthPage";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { PasskeyIcon } from "@/components/ui/icons";
import { ApiError, api } from "@/lib/api";
import { useArrive } from "@/lib/arrive";
import { addPasskeyHere, biometric, hasPasskeyHere, isCancelled, passkeysSupported } from "@/lib/passkeys";
import { signOutSettled } from "@/lib/use-sign-out";

export const Route = createFileRoute("/link")({
  component: LinkPage,
});

/**
 * "Sign in on another device": the link made on a signed-in device (its secret is after the # and never reaches a
 * server's logs) or its short code. Opening it asks for one tap, then signs in and offers a passkey for this device.
 */
function LinkPage() {
  const arrive = useArrive();
  const navigate = useNavigate();
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [code, setCode] = useState("");
  const [person, setPerson] = useState<Person | null>(null);

  // Read the secret once and take it out of the address bar and the history entry.
  useEffect(() => {
    const secret = window.location.hash.slice(1);
    setToken(secret || null);
    if (secret) history.replaceState(null, "", window.location.pathname);
  }, []);

  const redeem = useMutation({
    mutationFn: async () => {
      await signOutSettled();
      return api<SessionResponse>("/session/link", { method: "POST", json: token ? { token } : { code } });
    },
    onSuccess: async ({ user }) => {
      arrive.stay(user);
      if (passkeysSupported() && !hasPasskeyHere()) setPerson(user);
      else await arrive.goToday();
    },
  });

  const error = redeem.error instanceof ApiError ? redeem.error : null;
  // A used or expired link is a calm sentence, not an error page; a wrong code can just be tried again.
  const gone = error?.code === "link_gone" && token;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (redeem.isPending || (!token && code.trim().length < 8)) return;
    redeem.mutate();
  }

  if (person) return <AddHere person={person} onDone={() => void arrive.goToday()} />;

  if (token === undefined) return <AuthPage lead="One moment…">{null}</AuthPage>;

  if (gone) {
    return (
      <AuthPage lead="That link has done its job.">
        <p className="text-body text-ink-soft">
          It was already used, or it expired (they last ten minutes). Make a new one from a device you're signed in on,
          or sign in with your password.
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
      lead={token ? "Sign in on this device." : "Type the code from your other device."}
      footer={
        <Link to="/sign-in" className="focus-ring decoration-ink-ghost underline underline-offset-4">
          Back to sign in
        </Link>
      }
    >
      <form onSubmit={submit} noValidate>
        {token ? (
          <p className="text-body text-ink-soft mb-5">
            Someone made this link on a device where they're signed in. One tap and this device is signed in too.
          </p>
        ) : (
          <TextField
            label="Code"
            name="code"
            inputMode="text"
            autoComplete="one-time-code"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            placeholder="ABCD-EFGH"
            value={code}
            onChange={(event) => {
              const letters = event.target.value
                .toUpperCase()
                .replace(/[^A-Z0-9]/g, "")
                .slice(0, 8);
              setCode(letters.length > 4 ? formatCode(letters) : letters);
              if (error) redeem.reset();
            }}
            error={error ? error.message : undefined}
            autoFocus
            className="mb-5"
          />
        )}
        {redeem.error && !error && (
          <p role="alert" className="text-small text-tomato-ink mb-3 font-medium">
            Can't reach the kitchen. Check the connection and try again.
          </p>
        )}
        <Button type="submit" variant="primary" size="lg" fullWidth loading={redeem.isPending}>
          Sign in
        </Button>
      </form>
    </AuthPage>
  );
}

/** Signed in through a link: offers this device a passkey, once, then moves on either way. */
function AddHere({ person, onDone }: { person: Person; onDone: () => void }) {
  const add = useMutation({
    mutationFn: addPasskeyHere,
    onSuccess: onDone,
    onError: (error) => {
      if (isCancelled(error)) onDone();
    },
  });
  const word = biometric();
  return (
    <AuthPage lead={`Welcome, ${person.name}.`}>
      <p className="text-body text-ink-soft">
        {word === "a passkey" ? "Add a passkey" : `Use ${word}`} on this device, and next time you won't need a link or
        a password.
      </p>
      {add.error && !isCancelled(add.error) && (
        <p role="alert" className="text-small text-tomato-ink mt-3 font-medium">
          That didn't work. You can try again from the account menu later.
        </p>
      )}
      <Button
        variant="primary"
        size="lg"
        fullWidth
        icon={PasskeyIcon}
        loading={add.isPending}
        onClick={() => add.mutate()}
        className="mt-6"
      >
        {word === "a passkey" ? "Add a passkey" : `Add ${word}`}
      </Button>
      <Button variant="quiet" size="lg" fullWidth onClick={onDone} className="mt-2">
        Not now
      </Button>
    </AuthPage>
  );
}
