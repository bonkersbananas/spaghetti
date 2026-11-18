import { useRef, useState } from "react";
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

/**
 * A field that is being edited when the connection drops stays editable: the words keep coming and wait on this
 * device (lib/use-autosave.ts, lib/unsent.ts) to be saved when the connection returns. Only a field that has the
 * focus at that moment is kept (one the person had left, or never touched, is read-only as usual), and it goes back
 * to following `readOnly` when it loses the focus. Spread `onFocus` and `onBlur` on the field (or call them from its
 * own handlers) and use the `readOnly` it returns.
 */
export function useKeepEditing(readOnly: boolean) {
  const [focused, setFocused] = useState(false);
  const kept = useRef(false);
  if (!readOnly) kept.current = focused;
  else if (!focused) kept.current = false;
  return {
    readOnly: readOnly && !kept.current,
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
  };
}
