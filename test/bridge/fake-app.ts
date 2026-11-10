import type { Api } from "../../bridge/api.ts";
import { HttpError } from "../../bridge/api.ts";
import type { Attempt, Item } from "../../src/shared/api.ts";

/** A tiny in-memory Spaghetti for the bridge's unit tests: just what `Api` is asked. */
export class FakeApp {
  items = new Map<string, Item>();
  spools: Array<Record<string, unknown> & { id: string }> = [];
  slots: Record<string, string> = {};
  calls: Array<{ call: string; args: unknown }> = [];
  statuses: unknown[] = [];
  files = new Map<string, FormData>();
  photos: Array<{ itemId: string; photoId: string; form: FormData }> = [];
  /** While true every call fails like a network that's down. */
  down = false;
  /** Fail the next calls with this status. */
  refuse: { call: string; status: number } | null = null;

  private guard(call: string, args: unknown) {
    this.calls.push({ call, args });
    if (this.down) throw new TypeError("fetch failed");
    if (this.refuse?.call === call) throw new HttpError(this.refuse.status, `${call} refused`);
  }

  addBuild(title: string, attempts: Array<Partial<Attempt>> = []): Item {
    const id = crypto.randomUUID();
    const item = {
      id,
      stage: "building",
      title,
      note: "",
      attempts: attempts.map((attempt) => this.attempt(id, attempt)),
      photos: [],
    } as unknown as Item;
    this.items.set(id, item);
    return item;
  }

  attempt(itemId: string, fields: Partial<Attempt>): Attempt {
    return {
      id: crypto.randomUUID(),
      itemId,
      outcome: null,
      printedAt: Date.now(),
      finishedAt: null,
      endedAt: null,
      suggestedFailureTag: null,
      note: "",
      failureTags: [],
      successNotes: [],
      settings: {},
      changes: [],
      file: null,
      createdVia: null,
      ...fields,
    } as unknown as Attempt;
  }

  find(attemptId: string) {
    for (const item of this.items.values()) {
      const attempt = item.attempts.find((candidate) => candidate.id === attemptId);
      if (attempt) return { item, attempt };
    }
    return undefined;
  }

  get api(): Api {
    return {
      builds: async () => {
        this.guard("builds", null);
        return [...this.items.values()].filter((item) => item.stage === "building");
      },
      item: async (id: string) => {
        this.guard("item", id);
        const item = this.items.get(id);
        if (!item) throw new HttpError(404, "no item");
        return item;
      },
      createItem: async (body: { id: string; title: string | null }) => {
        this.guard("createItem", body);
        if (!this.items.has(body.id)) {
          this.items.set(body.id, {
            id: body.id,
            stage: "building",
            title: body.title,
            note: "",
            attempts: [],
            photos: [],
          } as unknown as Item);
        }
      },
      createAttempt: async (itemId: string, body: { id: string; printedAt?: number; settings?: object }) => {
        this.guard("createAttempt", { itemId, body });
        const item = this.items.get(itemId);
        if (!item) throw new HttpError(404, "no item");
        let attempt = item.attempts.find((candidate) => candidate.id === body.id);
        if (!attempt) {
          attempt = this.attempt(itemId, {
            id: body.id,
            printedAt: body.printedAt,
            settings: body.settings ?? item.attempts.at(-1)?.settings ?? {},
            createdVia: "agent-1",
          });
          item.attempts.push(attempt);
        }
        return attempt;
      },
      updateAttempt: async (id: string, body: Partial<Attempt>) => {
        this.guard("updateAttempt", { id, body });
        const found = this.find(id);
        if (!found) throw new HttpError(404, "no attempt");
        Object.assign(found.attempt, body);
        return found.attempt;
      },
      putFile: async (attemptId: string, form: FormData) => {
        this.guard("putFile", attemptId);
        const found = this.find(attemptId);
        if (!found) throw new HttpError(404, "no attempt");
        this.files.set(attemptId, form);
        found.attempt.file = { id: String(form.get("id")), name: String(form.get("name")) } as Attempt["file"];
        return { attempt: found.attempt };
      },
      putPhoto: async (itemId: string, photoId: string, form: FormData) => {
        this.guard("putPhoto", { itemId, photoId });
        this.photos.push({ itemId, photoId, form });
      },
      spools: async () => {
        this.guard("spools", null);
        return this.spools;
      },
      createSpool: async (body: { id: string }) => {
        this.guard("createSpool", body);
        if (!this.spools.some((spool) => spool.id === body.id)) this.spools.push({ ...body, slot: null });
      },
      updateSpool: async (id: string, body: object) => {
        this.guard("updateSpool", { id, body });
        Object.assign(this.spools.find((spool) => spool.id === id) ?? {}, body);
      },
      printer: async () => ({ slots: this.slots }),
      setSlot: async (slot: string, spoolId: string) => {
        this.guard("setSlot", { slot, spoolId });
        this.slots[slot] = spoolId;
        for (const spool of this.spools)
          spool.slot = spool.id === spoolId ? slot : spool.slot === slot ? null : spool.slot;
      },
      tell: async (body: unknown) => {
        this.guard("tell", body);
        this.statuses.push(body);
      },
    } as unknown as Api;
  }
}
