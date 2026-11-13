import { type StartUploadBody, type StartUploadResponse, UPLOAD_PART_BYTES, type UploadedPart } from "@shared/api";
import type { FileKind } from "@shared/slicing/types.ts";
import { ApiError, api } from "./api";
import { dropUpload, isRefusal, keyOf, type Open, open } from "./big-upload";
import { reportReachable, reportUnreachable } from "./connection";

/** Sends a big file in parts (see big-upload.ts): loaded when the first one goes, not with every screen. */

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
