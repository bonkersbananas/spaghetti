import type { SessionResponse } from "@shared/api";
import type {
  AddPasskeyRequest,
  CeremonyOptions,
  DevicesResponse,
  InvitesResponse,
  PasskeyInfo,
  PasskeysResponse,
  SignInWithPasskeyRequest,
} from "@shared/signing-in";
import { biometricName } from "@shared/signing-in";
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { toast } from "@/components/ui/Toast";
import { api } from "./api";
import { canEdit } from "./read-only";

// --- what this device can do, and what it has been asked ----------------------------------------------------

/** True where the browser can make and use passkeys at all. Read once; the answer is the same all session. */
export const passkeysSupported = () => typeof window !== "undefined" && "PublicKeyCredential" in window;

/** "Face ID" on an iPhone, "Touch ID" on a Mac, otherwise "a passkey". */
export const biometric = () => biometricName(typeof navigator === "undefined" ? "" : navigator.userAgent);

const HAS_PASSKEY = "sg-passkey-here";
const OFFER = "sg-passkey-offer";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode: the offer just shows again next time.
  }
}

/** This device has made a passkey, or signed in with one: no need to offer another. */
export const hasPasskeyHere = () => read(HAS_PASSKEY) === "1";
export const rememberPasskeyHere = () => write(HAS_PASSKEY, "1");

/**
 * "Next time, just Face ID?" is offered once per device: after the first password sign-in on a device with no
 * passkey, then never again, whether it was taken or dismissed.
 */
export const canOfferPasskey = () => passkeysSupported() && !hasPasskeyHere() && read(OFFER) === null;
export const offerSettled = () => write(OFFER, "done");

// --- the ceremonies (the browser code loads when one starts) --------------------------------------------------

const loadBrowser = () => import("@simplewebauthn/browser");

/** Adds a passkey for this device. Throws if the person cancels (NotAllowedError) or the server refuses. */
export async function addPasskeyHere(): Promise<PasskeyInfo> {
  const [{ startRegistration }, { ceremonyId, options }] = await Promise.all([
    loadBrowser(),
    api<CeremonyOptions<PublicKeyCredentialCreationOptionsJSON>>("/account/passkeys/options", { method: "POST" }),
  ]);
  const response = await startRegistration({ optionsJSON: options });
  const added = await api<PasskeyInfo>("/account/passkeys", {
    method: "POST",
    json: { ceremonyId, response } satisfies AddPasskeyRequest,
  });
  rememberPasskeyHere();
  return added;
}

/** Signs in with a passkey: through the browser's own sheet (`autofill: false`) or from the username field's list. */
export async function signInWithPasskey(autofill: boolean, signal?: AbortSignal): Promise<SessionResponse> {
  const [{ startAuthentication }, { ceremonyId, options }] = await Promise.all([
    loadBrowser(),
    api<CeremonyOptions<PublicKeyCredentialRequestOptionsJSON>>("/session/passkey/options", { method: "POST" }),
  ]);
  if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
  const response = await startAuthentication({ optionsJSON: options, useBrowserAutofill: autofill });
  const session = await api<SessionResponse>("/session/passkey", {
    method: "POST",
    json: { ceremonyId, response } satisfies SignInWithPasskeyRequest,
  });
  rememberPasskeyHere();
  return session;
}

/** Whether the username field can offer passkeys itself (conditional UI). */
export async function autofillSupported(): Promise<boolean> {
  if (!passkeysSupported()) return false;
  const { browserSupportsWebAuthnAutofill } = await loadBrowser();
  return browserSupportsWebAuthnAutofill();
}

/** The person closed the browser's sheet, or it timed out: not an error to show. */
export const isCancelled = (error: unknown) =>
  error instanceof Error && (error.name === "NotAllowedError" || error.name === "AbortError");

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
