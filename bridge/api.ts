/** Spaghetti's API as the bridge uses it, with its agent token. Only what the bridge needs. */
import type {
  Attempt,
  AttemptResponse,
  CreateAttemptRequest,
  CreateSpoolRequest,
  ItemResponse,
  ItemsResponse,
  PhotoResponse,
  PrinterResponse,
  SpoolResponse,
  SpoolsResponse,
  UpdateAttemptRequest,
  UpdateBridgeRequest,
  UpdateSpoolRequest,
} from "../src/shared/api.ts";

/** The app answered, with a status that says what to do next. */
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
  /** The app is busy or the bridge's token/URL is off: worth trying again later. */
  get retryable(): boolean {
    return (
      this.status >= 500 || this.status === 408 || this.status === 429 || this.status === 401 || this.status === 403
    );
  }
}

export class Api {
  private base: string;
  private token: string;
  private fetcher: typeof fetch;

  constructor(base: string, token: string, fetcher: typeof fetch = fetch) {
    this.base = base.replace(/\/+$/, "");
    this.token = token;
    this.fetcher = fetcher;
  }

  private async call<T>(method: string, path: string, body?: { json?: unknown; form?: FormData }): Promise<T> {
    const response = await this.fetcher(`${this.base}/api${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(body?.json !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body?.form ?? (body?.json !== undefined ? JSON.stringify(body.json) : undefined),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      const detail = await response.json().then(
        (x: { error?: { message?: string } }) => x.error?.message,
        () => undefined,
      );
      throw new HttpError(response.status, `${method} ${path}: ${response.status} ${detail ?? ""}`.trim());
    }
    return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
  }

  builds = async () => (await this.call<ItemsResponse>("GET", "/items?stage=building")).items;
  item = async (id: string) => (await this.call<ItemResponse>("GET", `/items/${id}`)).item;
  createItem = (body: { id: string; title: string | null; stage: "building" }) =>
    this.call("POST", "/items", { json: body });
  createAttempt = async (itemId: string, body: CreateAttemptRequest): Promise<Attempt> =>
    (await this.call<AttemptResponse>("POST", `/items/${itemId}/attempts`, { json: body })).attempt;
  updateAttempt = async (id: string, body: UpdateAttemptRequest): Promise<Attempt> =>
    (await this.call<AttemptResponse>("PATCH", `/attempts/${id}`, { json: body })).attempt;
  putFile = (attemptId: string, form: FormData) =>
    this.call<AttemptResponse>("PUT", `/attempts/${attemptId}/file`, { form });
  putPhoto = async (itemId: string, photoId: string, form: FormData) =>
    (await this.call<PhotoResponse>("PUT", `/items/${itemId}/photos/${photoId}`, { form })).photo;
  spools = async () => (await this.call<SpoolsResponse>("GET", "/spools")).spools;
  createSpool = async (body: CreateSpoolRequest) =>
    (await this.call<SpoolResponse>("POST", "/spools", { json: body })).spool;
  updateSpool = async (id: string, body: UpdateSpoolRequest) =>
    (await this.call<SpoolResponse>("PATCH", `/spools/${id}`, { json: body })).spool;
  printer = () => this.call<PrinterResponse>("GET", "/printer");
  setSlot = (slot: string, spoolId: string | null) =>
    this.call<PrinterResponse>("PUT", `/printer/slots/${slot}`, { json: { spoolId } });
  tell = (body: UpdateBridgeRequest) => this.call<PrinterResponse>("PUT", "/printer/bridge", { json: body });
}
