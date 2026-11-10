import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UpkeepResponse } from "../../src/shared/api.ts";
import { toBase64Url } from "../../src/shared/base64url.ts";
import { sendUpkeepNudge } from "../../src/worker/push/nudges.ts";
import { addUser, request, resetDb, signIn } from "./helpers.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const noon = Date.UTC(2026, 10, 10, 12);
const night = Date.UTC(2026, 10, 10, 23);

let cookie = "";
let alexId = "";

const upkeep = async () => (await (await request("/api/printer/upkeep", { cookie })).json()) as UpkeepResponse;
const task = async (id: string) => (await upkeep()).tasks.find((entry) => entry.id === id);
const done = (id: string, json: Record<string, unknown> = {}) =>
  request(`/api/printer/upkeep/${id}/done`, { method: "POST", cookie, json: { id: crypto.randomUUID(), ...json } });

/** A finished attempt that ran `minutes`, started `daysAgo` days back. */
async function printed(minutes: number, daysAgo: number) {
  const item = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO items (id, stage, note, created_by, created_at, updated_at) VALUES (?, 'building', '', ?, ?, ?)",
  )
    .bind(item, alexId, Date.now(), Date.now())
    .run();
  await env.DB.prepare(
    "INSERT INTO attempts (id, item_id, printed_at, outcome, created_by, created_at, updated_at, settings) VALUES (?, ?, ?, 'success', ?, ?, ?, ?)",
  )
    .bind(
      crypto.randomUUID(),
      item,
      Date.now() - daysAgo * DAY,
      alexId,
      Date.now(),
      Date.now(),
      JSON.stringify({ actualMinutes: minutes }),
    )
    .run();
}

beforeEach(async () => {
  await resetDb();
  alexId = await addUser("alex", "correct horse", "Alex", "tomato");
  await addUser("sam", "another horse", "Sam", "sea");
  cookie = await signIn("alex", "correct horse");
});

describe("GET /api/printer/upkeep", () => {
  it("starts with the X2D's list, nothing due, and no hours", async () => {
    const result = await upkeep();
    expect(result.tasks.map((entry) => entry.id).sort()).toEqual(
      ["belts", "desiccant", "nozzle", "plate", "purge-chute", "rods", "air-filter"].sort(),
    );
    expect(result.tasks.some((entry) => entry.due)).toBe(false);
    expect(result.printHours).toBe(0);
  });

  it("sums the attempts into the printer's hours", async () => {
    await printed(90, 3);
    await printed(30, 1);
    expect((await upkeep()).printHours).toBe(2);
  });

  it("puts what is most due first", async () => {
    await upkeep();
    await env.DB.prepare("UPDATE upkeep_tasks SET created_at = ?")
      .bind(Date.now() - 100 * DAY)
      .run();
    await env.DB.prepare("UPDATE upkeep_tasks SET created_at = ? WHERE id = 'belts'")
      .bind(Date.now() - 1 * DAY)
      .run();
    const result = await upkeep();
    expect(result.tasks[0]?.due).toBe(true);
    expect(result.tasks.at(-1)?.id).toBe("belts");
  });
});

describe("Done", () => {
  it("records who, when and the printer's hours, and resets the task", async () => {
    await upkeep();
    await env.DB.prepare("UPDATE upkeep_tasks SET created_at = 0").run();
    await printed(60 * 25, 2);
    expect((await task("plate"))?.due).toBe(true);
    const response = await done("plate", { note: "Soap and a rinse" });
    expect(response.status).toBe(200);
    const plate = await task("plate");
    expect(plate?.due).toBe(false);
    expect(plate?.sinceHours).toBeLessThan(0.1);
    expect(plate?.lastDone).toMatchObject({ doneBy: alexId, note: "Soap and a rinse", printerHours: 25 });
    expect(plate?.history).toHaveLength(1);
  });

  it("is idempotent on the log id", async () => {
    const id = crypto.randomUUID();
    await done("plate", { id });
    await done("plate", { id });
    expect((await task("plate"))?.history).toHaveLength(1);
  });

  it("takes a time in the past, with the hours at that moment, and refuses nothing for the future", async () => {
    await printed(60, 5);
    await printed(120, 1);
    await done("plate", { at: Date.now() - 3 * DAY });
    expect((await task("plate"))?.lastDone?.printerHours).toBe(1);
    await done("plate", { at: Date.now() + 10 * DAY });
    expect((await task("plate"))?.lastDone?.doneAt).toBeLessThanOrEqual(Date.now());
  });

  it("404s for a task that isn't there", async () => {
    expect((await done("nope")).status).toBe(404);
  });

  it("can be taken back (a person's undo)", async () => {
    await done("plate");
    const log = (await task("plate"))?.lastDone;
    expect((await request(`/api/printer/upkeep/logs/${log?.id}`, { method: "DELETE", cookie })).status).toBe(204);
    expect((await task("plate"))?.lastDone).toBeNull();
  });

  it("keeps a photo with the log", async () => {
    await done("plate");
    const log = (await task("plate"))?.lastDone;
    const form = new FormData();
    form.set("width", "10");
    form.set("height", "10");
    form.set("color", "#aabbcc");
    form.set("large", new File([new Uint8Array([1])], "l.webp", { type: "image/webp" }));
    form.set("thumb", new File([new Uint8Array([1])], "t.webp", { type: "image/webp" }));
    const photoId = crypto.randomUUID();
    const response = await request(`/api/printer/upkeep/logs/${log?.id}/photo/${photoId}`, {
      method: "PUT",
      cookie,
      body: form,
    });
    expect(response.status).toBe(200);
    expect((await task("plate"))?.lastDone?.photo?.id).toBe(photoId);
  });
});

describe("editing the list", () => {
  it("changes an interval, and keeps at least one", async () => {
    const patch = (json: unknown) => request("/api/printer/upkeep/plate", { method: "PATCH", cookie, json });
    expect((await patch({ intervalHours: 30 })).status).toBe(200);
    expect((await task("plate"))?.intervalHours).toBe(30);
    expect((await patch({ intervalHours: null, intervalDays: null })).status).toBe(400);
    expect((await patch({ intervalHours: null })).status).toBe(200);
    expect((await task("plate"))?.intervalHours).toBeNull();
  });

  it("adds a task of their own, once, and removes it with an undo", async () => {
    const json = { id: "lid", name: "Wipe the lid", intervalDays: 30 };
    await request("/api/printer/upkeep", { method: "POST", cookie, json });
    await request("/api/printer/upkeep", { method: "POST", cookie, json });
    expect((await upkeep()).tasks.filter((entry) => entry.id === "lid")).toHaveLength(1);
    expect(
      (await request("/api/printer/upkeep", { method: "POST", cookie, json: { id: "x", name: "No interval" } })).status,
    ).toBe(400);
    expect((await request("/api/printer/upkeep/lid", { method: "DELETE", cookie })).status).toBe(204);
    expect(await task("lid")).toBeUndefined();
    expect((await request("/api/printer/upkeep/lid/restore", { method: "POST", cookie })).status).toBe(200);
    expect(await task("lid")).toBeDefined();
  });

  it("does not bring a removed starting task back", async () => {
    await request("/api/printer/upkeep/belts", { method: "DELETE", cookie });
    expect(await task("belts")).toBeUndefined();
  });
});

describe("drying windows", () => {
  it("are kept with the printer's setup, whole", async () => {
    const put = (json: unknown) => request("/api/printer", { method: "PUT", cookie, json });
    const saved = (await (await put({ dryingDays: { petg: 10 } })).json()) as {
      setup: { dryingDays?: Record<string, number> };
    };
    expect(saved.setup.dryingDays).toEqual({ PETG: 10 });
    const other = (await (await put({ amsUnits: 2 })).json()) as { setup: { dryingDays?: Record<string, number> } };
    expect(other.setup.dryingDays).toEqual({ PETG: 10 });
    expect((await put({ dryingDays: { PLA: 0 } })).status).toBe(400);
  });
});

describe("the upkeep nudge", () => {
  let pushes: string[];
  beforeEach(() => {
    pushes = [];
    const real = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!url.startsWith("https://push.example/")) return real(input, init);
      pushes.push(url);
      return new Response(null, { status: 201 });
    });
  });
  afterEach(() => vi.restoreAllMocks());

  async function subscribe(name: string, upkeepNudges: boolean) {
    const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
      "deriveBits",
    ])) as CryptoKeyPair;
    const response = await request("/api/push/subscription", {
      method: "PUT",
      cookie,
      json: {
        endpoint: `https://push.example/${name}`,
        keys: {
          p256dh: toBase64Url(new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer)),
          auth: toBase64Url(crypto.getRandomValues(new Uint8Array(16))),
        },
        timeZone: "UTC",
        upkeepNudges,
      },
    });
    expect(response.status).toBe(204);
  }
  /** Two tasks long overdue. */
  const overdue = async () => {
    await upkeep();
    await env.DB.prepare("UPDATE upkeep_tasks SET created_at = ? WHERE id IN ('plate', 'belts')")
      .bind(noon - 200 * DAY)
      .run();
  };

  it("goes once to a device that asked, and at most one a day", async () => {
    await subscribe("phone", true);
    await overdue();
    expect(await sendUpkeepNudge(env, noon)).toEqual({ sent: 1 });
    expect(pushes).toEqual(["https://push.example/phone"]);
    // The second due task waits a day; the first isn't nudged twice.
    expect(await sendUpkeepNudge(env, noon + 2 * HOUR)).toEqual({ sent: 0 });
    expect(await sendUpkeepNudge(env, noon + 25 * HOUR)).toEqual({ sent: 1 });
    expect(await sendUpkeepNudge(env, noon + 50 * HOUR)).toEqual({ sent: 0 });
    expect(pushes).toHaveLength(2);
  });

  it("is off until the device switches it on", async () => {
    await subscribe("phone", false);
    await overdue();
    expect(await sendUpkeepNudge(env, noon)).toEqual({ sent: 0 });
    expect(pushes).toHaveLength(0);
  });

  it("waits for the morning, in quiet hours", async () => {
    await subscribe("phone", true);
    await overdue();
    expect(await sendUpkeepNudge(env, night)).toEqual({ sent: 0 });
    expect(await sendUpkeepNudge(env, Date.UTC(2026, 10, 11, 7, 30))).toEqual({ sent: 1 });
  });

  it("says nothing when nothing is due, and can nudge a task again after it was done and is due again", async () => {
    await subscribe("phone", true);
    await upkeep();
    expect(await sendUpkeepNudge(env, noon)).toEqual({ sent: 0 });
    await overdue();
    await sendUpkeepNudge(env, noon);
    await done("plate");
    const row = await env.DB.prepare("SELECT nudged_at FROM upkeep_tasks WHERE id = 'plate'").first<{
      nudged_at: number | null;
    }>();
    expect(row?.nudged_at).toBeNull();
  });
});
