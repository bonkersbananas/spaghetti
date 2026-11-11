/**
 * Signing in beyond a password: passkeys, "sign in on another device" links and invites
 * (docs/decisions/0026-passkeys-sign-in-links-and-invites.md). Types, limits and the words
 * the app uses, shared by the Worker and the browser.
 */
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import type { Person } from "./api.ts";
import type { PersonColor } from "./people.ts";

/** A ceremony's challenge is good for this long. */
export const CHALLENGE_TTL_MS = 5 * 60 * 1000;
/** "Sign in on another device" expires after this. */
export const SIGN_IN_LINK_TTL_MS = 10 * 60 * 1000;
/** An invite expires after this. */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** The characters of a short code: no 0/O or 1/I/L, so it can be read aloud and typed from a screen. */
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 8;

/** "ABCD-EFGH" from a typed code: uppercase, spaces and dashes dropped. Null if it can't be one. */
export function normalizeCode(input: string): string | null {
  const letters = input.toUpperCase().replace(/[\s-]/g, "");
  if (letters.length !== CODE_LENGTH) return null;
  for (const letter of letters) if (!CODE_ALPHABET.includes(letter)) return null;
  return letters;
}

export function formatCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

// --- devices -------------------------------------------------------------------------------------

/** What to call the device behind a user agent: "iPhone", "Mac · Chrome", "Windows PC · Firefox". */
export function deviceName(userAgent: string | null | undefined): string {
  const ua = userAgent ?? "";
  let device = "Unknown device";
  if (/iPhone/.test(ua)) device = "iPhone";
  else if (/iPad/.test(ua)) device = "iPad";
  else if (/Android/.test(ua)) device = /Mobile/.test(ua) ? "Android phone" : "Android tablet";
  else if (/Macintosh|Mac OS X/.test(ua)) device = "Mac";
  else if (/Windows/.test(ua)) device = "Windows PC";
  else if (/CrOS/.test(ua)) device = "Chromebook";
  else if (/Linux/.test(ua)) device = "Linux PC";
  if (device === "Unknown device") return device;
  // iOS browsers all say Safari underneath; the Home Screen app has no browser to name.
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /Firefox\/|FxiOS/.test(ua)
        ? "Firefox"
        : /Chrome\/|CriOS/.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : null;
  // On a phone the device is the useful part; elsewhere the browser tells two of the same machine apart.
  return browser && !/iPhone|iPad|Android/.test(ua) ? `${device} · ${browser}` : device;
}

/** How the screen says "a passkey on this device": Face ID on an iPhone, Touch ID on a Mac, else a passkey. */
export function biometricName(userAgent: string | null | undefined): "Face ID" | "Touch ID" | "a passkey" {
  const ua = userAgent ?? "";
  if (/iPhone/.test(ua)) return "Face ID";
  if (/Macintosh|Mac OS X/.test(ua) && !/iPad|iPhone/.test(ua)) return "Touch ID";
  return "a passkey";
}

// --- passkeys ------------------------------------------------------------------------------------

export interface PasskeyInfo {
  id: string;
  name: string;
  createdAt: number;
  lastUsedAt: number | null;
  /** Synced across the person's devices (iCloud Keychain, Google Password Manager). */
  backedUp: boolean;
}

export interface PasskeysResponse {
  passkeys: PasskeyInfo[];
  /** False for someone who joined with a passkey only: their last passkey can't be removed, nothing else would sign them in. */
  hasPassword: boolean;
}

/** What the browser needs to start a ceremony, and the id to send back with its answer. */
export interface CeremonyOptions<Options> {
  ceremonyId: string;
  options: Options;
}

export interface AddPasskeyRequest {
  ceremonyId: string;
  response: RegistrationResponseJSON;
}

export interface SignInWithPasskeyRequest {
  ceremonyId: string;
  response: AuthenticationResponseJSON;
}

export const MAX_PASSKEY_NAME = 40;

// --- sign in on another device -------------------------------------------------------------------

export interface SignInLinkInfo {
  id: string;
  createdAt: number;
  expiresAt: number;
  /** The device that used it, once someone did ("iPhone"). */
  usedOn: string | null;
  usedAt: number | null;
}

/** Made once; the token and the code are shown now and never again. */
export interface NewSignInLink extends SignInLinkInfo {
  /** The address to open on the other device: its secret is in the part after #, which no server sees. */
  url: string;
  /** The same sign-in as a code to type, "ABCD-EFGH". */
  code: string;
}

export interface RedeemSignInLinkRequest {
  token?: string;
  code?: string;
}

// --- invites -------------------------------------------------------------------------------------

export interface InviteInfo {
  id: string;
  createdAt: number;
  expiresAt: number;
  createdBy: string;
}

export interface InvitesResponse {
  invites: InviteInfo[];
}

export interface NewInvite extends InviteInfo {
  url: string;
}

/** What the invite page learns from a valid link: who asked, so it can say so. */
export interface InvitePeek {
  invitedBy: string;
  expiresAt: number;
}

export interface JoinDetails {
  token: string;
  name: string;
  username: string;
  color: PersonColor;
}

export interface JoinPasskeyOptionsRequest extends JoinDetails {}

export interface JoinRequest extends JoinDetails {
  /** A password, or the answer to the passkey ceremony asked for with /join/options: one of the two. */
  password?: string;
  passkey?: { ceremonyId: string; response: RegistrationResponseJSON };
}

// --- devices you are signed in on ----------------------------------------------------------------

export interface SignedInDevice {
  id: string;
  device: string;
  createdAt: number;
  lastSeenAt: number;
  /** The one this request came from. */
  current: boolean;
}

export interface DevicesResponse {
  devices: SignedInDevice[];
}

export type { Person };
