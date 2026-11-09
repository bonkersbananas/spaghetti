import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type {
  AttemptResponse,
  Item,
  ItemResponse,
  JournalResponse,
  JournalSummaryResponse,
} from "../../src/shared/api.ts";
import { addUser, request, resetDb, signIn } from "./helpers.ts";

let cookie: string;
let samCookie: string;
let samId: string;

beforeEach(async () => {
  await resetDb();
  await addUser("alex", "correct horse", "Alex Rivera", "tomato");
  samId = await addUser("sam", "battery staple", "Sam Okafor", "sea");
  cookie = await signIn("alex", "correct horse");
  samCookie = await signIn("sam", "battery staple");
});

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const ago = (ms: number) => Date.now() - ms;

async function createItem(body: Record<string, unknown> = {}, as = cookie): Promise<Item> {
  const response = await request("/api/items", {
    method: "POST",
    cookie: as,
    json: { id: crypto.randomUUID(), ...body },
  });
  expect(response.status).toBe(201);
  return (await response.json<ItemResponse>()).item;
}

async function logAttempt(itemId: string, body: Record<string, unknown> = {}, as = cookie) {
  const response = await request(`/api/items/${itemId}/attempts`, {
    method: "POST",
    cookie: as,
    json: { id: crypto.randomUUID(), settings: {}, ...body },
  });
  expect(response.status).toBe(201);
  return (await response.json<AttemptResponse>()).attempt;
}

async function journal(params: Record<string, string> = {}): Promise<JournalResponse> {
  const response = await request(`/api/journal?${new URLSearchParams(params)}`, { cookie });
  expect(response.status).toBe(200);
  return response.json<JournalResponse>();
}

/** Sets the dates the API stamps with "now", as if it all happened earlier. */
async function backdate(itemId: string, dates: { startedAt?: number; finishedAt?: number }) {
  await env.DB.prepare("UPDATE items SET started_at = coalesce(?, started_at), finished_at = ? WHERE id = ?")
    .bind(dates.startedAt ?? null, dates.finishedAt ?? null, itemId)
    .run();
}

const keys = (response: JournalResponse) => response.entries.map((entry) => entry.key);

describe("journal", () => {
  it("lists everything that happened, newest first", async () => {
    const idea = await createItem({ title: "Oven knob", createdAt: ago(10 * DAY) });
    const fromIdea = await createItem({ title: "Tugboat", createdAt: ago(9 * DAY) });
    await request(`/api/items/${fromIdea.id}`, { method: "PATCH", cookie, json: { stage: "building" } });
    await backdate(fromIdea.id, { startedAt: ago(8 * DAY) });
    const failed = await logAttempt(fromIdea.id, { outcome: "failed", printedAt: ago(7 * DAY) });
    const worked = await logAttempt(fromIdea.id, { outcome: "success", printedAt: ago(6 * DAY) });
    await request(`/api/items/${fromIdea.id}`, { method: "PATCH", cookie, json: { stage: "done" } });
    await backdate(fromIdea.id, { finishedAt: ago(5 * DAY) });
    const scratch = await createItem({ title: "Hook", stage: "building", createdAt: ago(4 * DAY) });
    const shelved = await createItem({ title: "Vase", stage: "building", createdAt: ago(3 * DAY) });
    await request(`/api/items/${shelved.id}`, { method: "PATCH", cookie, json: { stage: "shelved" } });
    await backdate(shelved.id, { finishedAt: ago(2 * DAY) });

    const page = await journal();
    expect(keys(page)).toEqual([
      `shelved:${shelved.id}`,
      `started:${shelved.id}`,
      // A build started from scratch was never an idea.
      `started:${scratch.id}`,
      `finished:${fromIdea.id}`,
      `attempt:${worked.id}`,
      `attempt:${failed.id}`,
      `started:${fromIdea.id}`,
      `idea:${fromIdea.id}`,
      `idea:${idea.id}`,
    ]);
    expect(page.next).toBeNull();
    expect(page.entries[4]).toMatchObject({ kind: "attempt", itemId: fromIdea.id, attemptId: worked.id });
    // Every item the entries mention comes along, with its attempts and photos.
    expect(page.items.map((item) => item.id).sort()).toEqual([idea.id, fromIdea.id, scratch.id, shelved.id].sort());
    expect(page.items.find((item) => item.id === fromIdea.id)?.attempts).toHaveLength(2);
  });

  it("puts an attempt above the build it started when they happen at once", async () => {
    const idea = await createItem({ title: "Clip", createdAt: ago(DAY) });
    const attempt = await logAttempt(idea.id, { outcome: null });
    const { item } = await (await request(`/api/items/${idea.id}`, { cookie })).json<ItemResponse>();
    await env.DB.prepare("UPDATE attempts SET printed_at = ? WHERE id = ?").bind(item.startedAt, attempt.id).run();
    expect(keys(await journal())).toEqual([`attempt:${attempt.id}`, `started:${idea.id}`, `idea:${idea.id}`]);
  });

  it("pages through a long history without repeating or skipping", async () => {
    const build = await createItem({ title: "Cubes", stage: "building", createdAt: ago(30 * DAY) });
    const logged: string[] = [];
    for (let i = 0; i < 11; i++) {
      // Two at the same moment: the cursor must still tell them apart.
      const printedAt = ago((20 - Math.floor(i / 2)) * DAY);
      logged.push((await logAttempt(build.id, { outcome: "success", printedAt })).id);
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page: JournalResponse = await journal({ limit: "4", ...(cursor ? { cursor } : {}) });
      expect(page.entries.length).toBeLessThanOrEqual(4);
      seen.push(...keys(page));
      cursor = page.next;
      pages++;
    } while (cursor && pages < 10);
    expect(pages).toBe(3);
    expect(seen).toHaveLength(12);
    expect(new Set(seen).size).toBe(12);
    expect(seen.at(-1)).toBe(`started:${build.id}`);
    expect(seen.filter((key) => key.startsWith("attempt:")).sort()).toEqual(logged.map((id) => `attempt:${id}`).sort());
    // Newest first across pages.
    const page1 = await journal({ limit: "4" });
    const page2 = await journal({ limit: "4", cursor: page1.next ?? "" });
    expect(page1.entries.at(-1)?.at).toBeGreaterThanOrEqual(page2.entries[0]?.at ?? 0);
  });

  it("filters to failures, an outcome, a material or a person", async () => {
    const build = await createItem({ title: "Box", stage: "building", createdAt: ago(5 * DAY) });
    const idea = await createItem({ title: "Sam's idea", createdAt: ago(4 * DAY) }, samCookie);
    const failed = await logAttempt(build.id, {
      outcome: "failed",
      printedAt: ago(3 * DAY),
      settings: { filaments: [{ type: "PETG" }] },
    });
    const partial = await logAttempt(
      build.id,
      { outcome: "partial", printedAt: ago(2 * DAY), settings: { filaments: [{ type: "pla" }] } },
      samCookie,
    );
    const worked = await logAttempt(build.id, {
      outcome: "success",
      printedAt: ago(DAY),
      settings: { filaments: [{ type: "PLA" }, { type: "PETG" }] },
    });
    const printing = await logAttempt(build.id, { outcome: null, printedAt: ago(MIN) });

    expect(keys(await journal({ outcome: "failures" }))).toEqual([`attempt:${partial.id}`, `attempt:${failed.id}`]);
    expect(keys(await journal({ outcome: "failed" }))).toEqual([`attempt:${failed.id}`]);
    expect(keys(await journal({ outcome: "success" }))).toEqual([`attempt:${worked.id}`]);
    expect(keys(await journal({ material: "petg" }))).toEqual([`attempt:${worked.id}`, `attempt:${failed.id}`]);
    expect(keys(await journal({ material: "PLA", outcome: "failures" }))).toEqual([`attempt:${partial.id}`]);
    expect(keys(await journal({ person: samId }))).toEqual([`attempt:${partial.id}`, `idea:${idea.id}`]);
    expect(keys(await journal())).toContain(`attempt:${printing.id}`);

    const response = await request("/api/journal?outcome=burnt", { cookie });
    expect(response.status).toBe(400);
  });

  it("leaves out what was deleted", async () => {
    const build = await createItem({ title: "Gone", stage: "building" });
    const kept = await createItem({ title: "Kept", stage: "building" });
    await logAttempt(build.id, { outcome: "failed" });
    const deletedAttempt = await logAttempt(kept.id, { outcome: "failed" });
    await request(`/api/items/${build.id}`, { method: "DELETE", cookie });
    await request(`/api/attempts/${deletedAttempt.id}`, { method: "DELETE", cookie });
    expect(keys(await journal())).toEqual([`started:${kept.id}`]);
  });
});

describe("month summary", () => {
  it("counts the prints, the spaghetti and the builds finished in a span", async () => {
    const from = ago(30 * DAY);
    const to = Date.now();
    const build = await createItem({ title: "Tugboat", stage: "building", createdAt: ago(40 * DAY) });
    await logAttempt(build.id, { outcome: "failed", printedAt: ago(20 * DAY) });
    await logAttempt(build.id, { outcome: "failed", printedAt: ago(19 * DAY) });
    await logAttempt(build.id, { outcome: "partial", printedAt: ago(18 * DAY) });
    await logAttempt(build.id, { outcome: "success", printedAt: ago(17 * DAY) });
    await logAttempt(build.id, { outcome: "success", printedAt: ago(35 * DAY) });
    await logAttempt(build.id, { outcome: null, printedAt: ago(DAY) });
    await request(`/api/items/${build.id}`, { method: "PATCH", cookie, json: { stage: "done" } });
    await backdate(build.id, { finishedAt: ago(16 * DAY) });

    const response = await request(`/api/journal/summary?from=${from}&to=${to}`, { cookie });
    const { summary } = await response.json<JournalSummaryResponse>();
    expect(summary).toEqual({
      prints: 4,
      worked: 1,
      partly: 1,
      spaghetti: 2,
      finished: [{ id: build.id, title: "Tugboat" }],
    });
  });
});
