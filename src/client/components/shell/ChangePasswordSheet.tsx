import { type ChangePasswordResponse, MIN_PASSWORD_LENGTH } from "@shared/api";
import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { EyeIcon, EyeSlashIcon } from "@/components/ui/icons";
import { Sheet } from "@/components/ui/Sheet";
import { toast } from "@/components/ui/Toast";
import { ApiError, api } from "@/lib/api";
import { sessionQuery } from "@/lib/queries";

/**
 * Change your own password: the current one, a new one and a "show" toggle in place of a confirm field.
 * The username sits in the form, hidden, so a password manager updates the right entry.
 */
export function ChangePasswordSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { data: user } = useSuspenseQuery(sessionQuery);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [shown, setShown] = useState(false);
  const currentRef = useRef<HTMLInputElement>(null);

  // A sheet that closes forgets what was typed; one that stays open keeps it, even after a wrong password.
  useEffect(() => {
    if (!open) {
      setCurrent("");
      setNext("");
      setShown(false);
    }
  }, [open]);

  const change = useMutation({
    mutationFn: () =>
      api<ChangePasswordResponse>("/account/password", {
        method: "PUT",
        json: { currentPassword: current, newPassword: next },
      }),
    onSuccess: ({ signedOut }) => {
      onOpenChange(false);
      toast.success("Password changed", signedOut > 0 ? "Signed out on your other devices" : undefined);
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === "wrong_password") currentRef.current?.focus();
    },
  });

  const apiError = change.error instanceof ApiError ? change.error : null;
  const unreachable = change.error && !apiError;
  const currentError =
    apiError && (apiError.code === "wrong_password" || apiError.code === "rate_limited") ? apiError.message : undefined;
  const nextError =
    apiError && (apiError.code === "too_short" || apiError.code === "same_password") ? apiError.message : undefined;
  const tooShort = next.length > 0 && next.length < MIN_PASSWORD_LENGTH;
  const ready = current.length > 0 && next.length >= MIN_PASSWORD_LENGTH;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready || change.isPending) return;
    change.mutate();
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Change password"
      description="Your other devices will be signed out."
      footer={
        <Button
          type="submit"
          form="change-password"
          variant="primary"
          fullWidth
          loading={change.isPending}
          disabled={!ready}
        >
          Save new password
        </Button>
      }
    >
      <form id="change-password" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <input
          type="text"
          name="username"
          autoComplete="username"
          value={user?.username ?? ""}
          readOnly
          hidden
          aria-hidden
          tabIndex={-1}
        />
        <TextField
          ref={currentRef}
          label="Current password"
          name="current-password"
          type={shown ? "text" : "password"}
          autoComplete="current-password"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={current}
          onChange={(event) => {
            setCurrent(event.target.value);
            if (currentError) change.reset();
          }}
          error={currentError}
          autoFocus
        />
        <TextField
          label="New password"
          name="new-password"
          type={shown ? "text" : "password"}
          autoComplete="new-password"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={next}
          onChange={(event) => {
            setNext(event.target.value);
            if (nextError) change.reset();
          }}
          error={nextError}
          hint={
            tooShort
              ? `${MIN_PASSWORD_LENGTH - next.length} more to go`
              : `At least ${MIN_PASSWORD_LENGTH} characters. A few words is plenty.`
          }
        />
        <Button
          variant="quiet"
          size="sm"
          icon={shown ? EyeSlashIcon : EyeIcon}
          aria-pressed={shown}
          onClick={() => setShown((s) => !s)}
          className="-mt-1 -ml-2.5 self-start"
        >
          {shown ? "Hide" : "Show"}
        </Button>
        {unreachable && (
          <p role="alert" className="text-small text-tomato-ink font-medium">
            Can't reach the kitchen. Check the connection and try again.
          </p>
        )}
      </form>
    </Sheet>
  );
}
