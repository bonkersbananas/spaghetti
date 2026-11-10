import { toast } from "@/components/ui/Toast";
import { isOnline, useOnline } from "./connection";

/**
 * Without a connection, what was saved on the server is only for reading:
 * a change would be made on a copy that may already be out of date (two
 * people share this data) and could not be sent. Captures, new attempts and
 * anything still waiting in the outbox are the exceptions; they are on this
 * device, so `pending` things stay editable.
 */
export function useReadOnly(pending = false): boolean {
  return !useOnline() && !pending;
}

/** For changes started from a shortcut: true when the change may go ahead, else says why it won't. */
export function canEdit(pending = false): boolean {
  if (pending || isOnline()) return true;
  toast.message("Waiting for the connection", "Saved things can't be changed offline.");
  return false;
}

export const READ_ONLY_REASON = "Saved things can only be changed when you're back online.";
