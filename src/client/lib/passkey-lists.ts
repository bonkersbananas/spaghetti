import type { DevicesResponse, InvitesResponse, PasskeyInfo, PasskeysResponse } from "@shared/signing-in";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { toast } from "@/components/ui/Toast";
import { api } from "./api";
import { canEdit } from "./read-only";

/** The lists behind the account menu's sign-in sheets: their own file, so the sign-in screen and the shell don't carry them. */

// --- queries -----------------------------------------------------------------------------------------------

export const passkeysQuery = queryOptions({
  queryKey: ["passkeys"],
  queryFn: async () => (await api<PasskeysResponse>("/account/passkeys")).passkeys,
});

export const devicesQuery = queryOptions({
  queryKey: ["devices"],
  queryFn: async () => (await api<DevicesResponse>("/account/devices")).devices,
});

export const invitesQuery = queryOptions({
  queryKey: ["invites"],
  queryFn: async () => (await api<InvitesResponse>("/account/invites")).invites,
});

// --- removing a passkey: gone at once, taken back with Undo, sent when the toast has gone ---------------------

const REMOVE_UNDO_MS = 6000;
const waiting = new Map<string, ReturnType<typeof setTimeout>>();

export function removePasskey(queryClient: QueryClient, passkey: PasskeyInfo) {
  if (!canEdit() || waiting.has(passkey.id)) return;
  const key = passkeysQuery.queryKey;
  const before = queryClient.getQueryData<PasskeyInfo[]>(key) ?? [];
  queryClient.setQueryData<PasskeyInfo[]>(
    key,
    before.filter((p) => p.id !== passkey.id),
  );
  waiting.set(
    passkey.id,
    setTimeout(async () => {
      try {
        await api(`/account/passkeys/${passkey.id}`, { method: "DELETE" });
      } catch {
        toast.error("Couldn't remove that passkey", "It still works. Try again in a moment.");
      } finally {
        waiting.delete(passkey.id);
        void queryClient.invalidateQueries({ queryKey: key });
      }
    }, REMOVE_UNDO_MS),
  );
  toast.undo("Passkey removed", {
    description: passkey.name,
    duration: REMOVE_UNDO_MS,
    onUndo: () => {
      clearTimeout(waiting.get(passkey.id));
      waiting.delete(passkey.id);
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    for (const [id, timer] of waiting) {
      clearTimeout(timer);
      void api(`/account/passkeys/${id}`, { method: "DELETE", keepalive: true }).catch(() => undefined);
    }
  });
}

export async function renamePasskey(queryClient: QueryClient, id: string, name: string) {
  const key = passkeysQuery.queryKey;
  queryClient.setQueryData<PasskeyInfo[]>(key, (list) => list?.map((p) => (p.id === id ? { ...p, name } : p)));
  try {
    await api(`/account/passkeys/${id}`, { method: "PATCH", json: { name } });
  } catch {
    toast.error("Couldn't rename that passkey");
  } finally {
    void queryClient.invalidateQueries({ queryKey: key });
  }
}
