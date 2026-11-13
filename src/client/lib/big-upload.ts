import { type StartUploadBody, type StartUploadResponse, UPLOAD_PART_BYTES, type UploadedPart } from "@shared/api";
import type { FileKind } from "@shared/slicing/types.ts";
import { useSyncExternalStore } from "react";
import { ApiError, api } from "./api";
import { reportReachable, reportUnreachable } from "./connection";

/**
 * A big file (over ONE_REQUEST_FILE_BYTES) goes to the server in parts, one request each (a request body may hold
 * 100 MB at most): POST /api/uploads starts it, each part is PUT with its progress, and complete puts them together
 * (decision 0048). A part that fails is sent again a few times; a file that still doesn't get through keeps what is
 * sent, so trying again carries on from the next part while this tab lives. Only the card's `useUpload` knows about
 * it: it shows the percent, or "Didn't finish" with one tap to try again.
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
interface Open {
  uploadId: string;
  partSize: number;
  size: number;
  parts: Map<number, string>;
}
const open = new Map<string, Open>();

const keyOf = (id: string, part: string) => `${id}/${part}`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The tries for each part, and the wait before each next one. */
const PART_TRIES = 4;
const waitBefore = (attempt: number) => 1_000 * 2 ** (attempt - 1);

/** One part with its progress; throws ApiError for an answer that isn't a success, and TypeError when it never came. */
function putPart(path: string, body: Blob, onProgress: (loaded: number) => void, signal?: AbortSignal) {
  return new Promise<UploadedPart>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `/api${path}`);
    xhr.setRequestHeader("Accept", "application/json");
    xhr.upload.onprogress = (event) => onProgress(event.loaded);
    xhr.onload = () => {
      reportReachable();
      let parsed: { n?: number; etag?: string; error?: { code?: string; message?: string } } = {};
      try {
        parsed = JSON.parse(xhr.responseText);
      } catch {
        // Not JSON: the status says enough.
      }
      if (xhr.status >= 200 && xhr.status < 300 && parsed.etag) {
        resolve({ n: parsed.n ?? 0, etag: parsed.etag });
      } else {
        reject(new ApiError(xhr.status, parsed.error?.code ?? "unknown", parsed.error?.message ?? "A part failed."));
      }
    };
    xhr.onerror = () => {
      reportUnreachable();
      reject(new TypeError("The connection was lost."));
    };
    xhr.ontimeout = () => reject(new TypeError("A part took too long."));
    xhr.onabort = () => reject(new DOMException("Cancelled", "AbortError"));
    xhr.timeout = 10 * 60_000;
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(body);
  });
}

/** An answer that retrying won't change: the file is refused, or isn't wanted any more. */
export const isRefusal = (error: unknown) =>
  error instanceof ApiError &&
  error.status >= 400 &&
  error.status < 500 &&
  ![404, 408, 409, 429].includes(error.status);

/**
 * Sends `blob` to the server in parts, as the bytes of file `id` (`part` "file") or of a model's sliced file
 * (`part` "sliced"). Resolves when the server has the whole file. Throws when it can't: an ApiError for a refusal
 * (see isRefusal; the upload is then dropped), anything else when the connection won't carry it, in which case what
 * was sent is kept for the next call. `onProgress` gets 0-1.
 */
export async function uploadInParts(options: {
  id: string;
  part: StartUploadBody["part"];
  kind: FileKind;
  name: string;
  blob: Blob;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}): Promise<void> {
  const { id, part, kind, name, blob, onProgress, signal } = options;
  const key = keyOf(id, part);

  const begin = async (): Promise<Open> => {
    const started = await api<StartUploadResponse>("/uploads", {
      method: "POST",
      json: { id, part, kind, name, size: blob.size } satisfies StartUploadBody,
      keepalive: false,
    });
    const fresh = { uploadId: started.uploadId, partSize: started.partSize, size: blob.size, parts: new Map() };
    open.set(key, fresh);
    return fresh;
  };

  let current = open.get(key);
  // Another file under this id, or a changed one, starts over.
  if (current && (current.size !== blob.size || current.partSize !== UPLOAD_PART_BYTES)) current = undefined;
  current ??= await begin();

  const base = (path = "") => `/uploads/${id}/${part}/${encodeURIComponent(current?.uploadId ?? "")}${path}`;
  let restarted = false;
  try {
    const count = Math.ceil(blob.size / current.partSize);
    const report = (loaded: number) => onProgress?.(Math.min(1, loaded / blob.size));
    for (let n = 1; n <= count; n++) {
      if (current.parts.has(n)) continue;
      const start = (n - 1) * current.partSize;
      const piece = blob.slice(start, Math.min(blob.size, start + current.partSize));
      for (let attempt = 1; ; attempt++) {
        if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
        try {
          const done = await putPart(base(`/${n}`), piece, (loaded) => report(start + loaded), signal);
          current.parts.set(n, done.etag);
          report(start + piece.size);
          break;
        } catch (error) {
          if (error instanceof DOMException) throw error;
          // The upload is gone from the server (it was dropped): once, start again from the first part.
          if (error instanceof ApiError && error.status === 404 && !restarted) {
            restarted = true;
            current = await begin();
            n = 0;
            break;
          }
          if (isRefusal(error) || attempt >= PART_TRIES) throw error;
          report(start);
          await sleep(waitBefore(attempt));
        }
      }
    }
    await api(base("/complete"), {
      method: "POST",
      json: {
        size: blob.size,
        parts: [...current.parts].map(([n, etag]) => ({ n, etag })),
      },
      keepalive: false,
    });
    open.delete(key);
    onProgress?.(1);
  } catch (error) {
    if (isRefusal(error)) await dropUpload(id, part);
    // The parts can't be put together (the server lost one): start again next time.
    else if (error instanceof ApiError && error.status === 409) open.delete(key);
    throw error;
  }
}

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
