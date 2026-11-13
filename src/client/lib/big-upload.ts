import type { StartUploadBody } from "@shared/api";
import { useSyncExternalStore } from "react";
import { ApiError, api } from "./api";

/**
 * A big file (over ONE_REQUEST_FILE_BYTES) goes to the server in parts, one request each (a request body may hold
 * 100 MB at most): POST /api/uploads starts it, each part is PUT with its progress, and complete puts them together
 * (decision 0048). A part that fails is sent again a few times; a file that still doesn't get through keeps what is
 * sent, so trying again carries on from the next part while this tab lives. Only the card's `useUpload` knows about
 * it: it shows the percent, or "Didn't finish" with one tap to try again.
 *
 * This file is the small part every screen carries (the outbox and the idea files use it): what a card shows, and
 * forgetting an upload. The sending itself, with its parts and retries, is big-upload-parts.ts, which loads when a
 * big file is first sent.
 */

/** How the card shows a big file's upload. */
export interface UploadState {
  /** 0-1 while it goes. */
  fraction: number;
  /** It stopped before the end: the card says so and offers `retry`. */
  failed: boolean;
  retry?: () => void;
}

const states = new Map<string, UploadState>();
const listeners = new Set<() => void>();
let snapshot: ReadonlyMap<string, UploadState> = new Map();

function emit() {
  snapshot = new Map(states);
  for (const listener of listeners) listener();
}

/** Sets (or, with null, forgets) how a file's upload is going. Whole percents only: no renders for nothing. */
export function setUpload(id: string, state: UploadState | null) {
  if (!state) {
    if (states.delete(id)) {
      keepWarning();
      emit();
    }
    return;
  }
  const before = states.get(id);
  if (
    before &&
    before.failed === state.failed &&
    before.retry === state.retry &&
    Math.floor(before.fraction * 100) === Math.floor(state.fraction * 100)
  ) {
    return;
  }
  states.set(id, state);
  keepWarning();
  emit();
}

/** Leaving the page loses a file that is still on its way (its bytes are only in this tab): the browser asks first. */
const warn = (event: BeforeUnloadEvent) => event.preventDefault();
let warning = false;
function keepWarning() {
  if (typeof window === "undefined" || warning === states.size > 0) return;
  warning = states.size > 0;
  if (warning) window.addEventListener("beforeunload", warn);
  else window.removeEventListener("beforeunload", warn);
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** How a big file's upload is going, if it is one. */
export function useUpload(id: string): UploadState | undefined {
  return useSyncExternalStore(
    subscribe,
    () => snapshot.get(id),
    () => undefined,
  );
}

/** An upload that is open on the server, with the parts it has. */
export interface Open {
  uploadId: string;
  partSize: number;
  size: number;
  parts: Map<number, string>;
}
export const open = new Map<string, Open>();

export const keyOf = (id: string, part: string) => `${id}/${part}`;

/** An answer that retrying won't change: the file is refused, or isn't wanted any more. */
export const isRefusal = (error: unknown) =>
  error instanceof ApiError &&
  error.status >= 400 &&
  error.status < 500 &&
  ![404, 408, 409, 429].includes(error.status);

/** Forgets an upload and tells the server to drop what it holds (a file taken off, or refused). */
export async function dropUpload(id: string, part: StartUploadBody["part"] = "file") {
  const key = keyOf(id, part);
  const current = open.get(key);
  open.delete(key);
  if (!current) return;
  await api(`/uploads/${id}/${part}/${encodeURIComponent(current.uploadId)}`, {
    method: "DELETE",
    keepalive: false,
  }).catch(() => undefined);
}

/**
 * A phone has the memory to slice a model, or to draw a print in 3D, up to about this size. Bigger files are kept
 * all the same; only these two things wait for a laptop or desktop (the card says so in one line).
 */
export const PHONE_FILE_BYTES = 100 * 1024 * 1024;

/** Whether a file of `size` bytes is more than this device can slice or draw: a phone (a touch screen) and over the line. */
export const tooBigForPhone = (size: number) =>
  size > PHONE_FILE_BYTES && typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;

/** A finished upload whose row was refused (or never saved): the server removes the bytes, if no row owns them. */
export const discardUpload = (id: string) =>
  api(`/uploads/${id}/file`, { method: "DELETE", keepalive: false }).catch(() => undefined);

/** Sends a big file in parts (big-upload-parts.ts, loaded here when the first one goes): the options and the rules are its. */
export const uploadInParts: typeof import("./big-upload-parts").uploadInParts = (options) =>
  import("./big-upload-parts").then((module) => module.uploadInParts(options));
