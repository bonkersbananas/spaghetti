import type { ApiErrorBody } from "@shared/api";
import { reportReachable, reportUnreachable } from "./connection";
import { reserveKeepalive, wantsKeepalive } from "./keepalive";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

/** Fetches JSON from the Worker's /api. Throws ApiError on any non-2xx. */
export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const jsonBody = json !== undefined ? JSON.stringify(json) : rest.body;
  // Small writes finish even if the page goes away right after (see keepalive.ts); an explicit keepalive wins.
  const release = rest.keepalive === undefined && wantsKeepalive(rest.method, path) ? reserveKeepalive(jsonBody) : null;
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      credentials: "same-origin",
      ...rest,
      ...(release ? { keepalive: true } : {}),
      headers: {
        Accept: "application/json",
        ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: jsonBody,
    });
  } catch (error) {
    // fetch only rejects when the request never got an answer.
    reportUnreachable();
    throw error;
  } finally {
    release?.();
  }
  reportReachable();
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (body as ApiErrorBody | null)?.error;
    throw new ApiError(response.status, error?.code ?? "unknown", error?.message ?? "Something went wrong.");
  }
  return body as T;
}
