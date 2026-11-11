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
