import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NewTokenResponse } from "../../src/shared/agents.ts";
import type { FeaturesResponse, ItemResponse } from "../../src/shared/api.ts";
import { cleanTitle, TITLES_PER_DAY } from "../../src/shared/title.ts";
import { app } from "../../src/worker/app.ts";
import { getDb } from "../../src/worker/db/index.ts";
import { resumeTitles, runTitle, STALE_MS, startTitle } from "../../src/worker/title/run.ts";
import { addUser, ORIGIN, request, resetDb, signIn, uploadPhoto } from "./helpers.ts";

type Answer = { title?: string | null; stopReason?: string; status?: number };

/** Stubs the Anthropic API; Responses are made inside the stub (a Response can't cross requests). */
function stubClaude(answer: Answer | (() => Answer) = { title: "Spool holder for the shelf" }) {
  const bodies: Array<Record<string, unknown>> = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname !== "api.anthropic.com") return new Response("nope", { status: 404 });
    bodies.push(JSON.parse(String(init?.body)));
    const next = typeof answer === "function" ? answer() : answer;
    if (next.status)
      return Response.json({ type: "error", error: { type: "api_error", message: "no" } }, { status: next.status });
    return Response.json({
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: "claude-haiku-5-5",
      content:
        next.stopReason === "refusal" ? [] : [{ type: "text", text: JSON.stringify({ title: next.title ?? null }) }],
      stop_reason: next.stopReason ?? "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 10 },
    });
  });
  return { bodies };
}

let cookie: string;

beforeEach(async () => {
  await resetDb();
  await addUser("alex", "correct horse", "Alex Rivera", "tomato");
  cookie = await signIn("alex", "correct horse");
  env.TITLES_ON_SAVE = "on";
});
afterEach(() => {
  env.TITLES_ON_SAVE = "off";
  vi.restoreAllMocks();
});

const uuid = () => crypto.randomUUID();
const asPerson = (path: string, init: Parameters<typeof request>[1] = {}) => request(path, { cookie, ...init });
const getItem = async (itemId: string) => (await (await asPerson(`/api/items/${itemId}`)).json<ItemResponse>()).item;
const rows = async () => (await env.DB.prepare("SELECT * FROM item_titles").all()).results;
/** Waits for the job that runs after the save's response (it gives the capture a moment first). */
const settled = () =>
  vi.waitFor(
    async () => {
      const all = await rows();
      expect(all.length).toBeGreaterThan(0);
      expect(all.every((row) => row.status !== "naming")).toBe(true);
      return all;
    },
    { timeout: 8000, interval: 100 },
  );

async function capture(fields: { title?: string; note?: string } = {}) {
  const itemId = uuid();
  const made = await asPerson("/api/items", { method: "POST", json: { id: itemId, ...fields } });
  expect(made.status).toBe(201);
  return itemId;
}

describe("Claude names an idea saved without a title", () => {
  it("names a photo-only idea after its first photo, from the photo, and marks the title as Claude's", async () => {
    const web = stubClaude();
    const itemId = await capture();
    // No photo and no words yet: nothing to name it from.
    expect(await rows()).toEqual([]);
    expect((await uploadPhoto(itemId, uuid(), cookie)).status).toBe(201);
    // At once nothing changes: the idea is still untitled.
    expect((await getItem(itemId)).title).toBeNull();
    await settled();
    const item = await getItem(itemId);
    expect(item).toMatchObject({
      title: "Spool holder for the shelf",
      claudeTitle: "Spool holder for the shelf",
      titleJob: null,
    });
    // The photo went in as an image, to the small model, with no thinking and a schema for the answer.
    const body = web.bodies[0] as {
      model: string;
      thinking: { type: string };
      output_config: { effort: string; format: { type: string } };
      messages: Array<{ content: Array<{ type: string; text?: string }> }>;
    };
    expect(web.bodies).toHaveLength(1);
    expect(body.model).toBe("claude-haiku-5-5");
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.output_config).toMatchObject({ effort: "low", format: { type: "json_schema" } });
    expect(body.messages[0]?.content.map((block) => block.type)).toEqual(["image", "text"]);
    expect(body.messages[0]?.content[1]?.text).toContain("There is no note");
    // The run is on record, without the photo.
    const [row] = await rows();
    expect(row).toMatchObject({ status: "titled", run_outcome: "titled", title: "Spool holder for the shelf" });
    expect(JSON.parse(String(row?.detail))).toMatchObject({ model: "claude-haiku-5-5", photos: 1, noteChars: 0 });
    // The other screens heard of it through the feed.
    const feed = await (await asPerson("/api/changes?after=0")).json<{
      changes: Array<{ entity: string; id: string; action: string }>;
    }>();
    expect(feed.changes.filter((c) => c.entity === "item" && c.id === itemId && c.action === "updated")).toHaveLength(
      1,
    );
    // A second photo doesn't ask again: an idea is named once.
    await uploadPhoto(itemId, uuid(), cookie);
    expect(await rows()).toHaveLength(1);
    expect(web.bodies).toHaveLength(1);
  });

  it("names a note-only idea from its words, in their language", async () => {
    const web = stubClaude({ title: "Kabelklämma, 6 mm" });
    const itemId = await capture({ note: "klämma för kablarna bakom skrivbordet, 6 mm" });
    await settled();
    expect((await getItem(itemId)).title).toBe("Kabelklämma, 6 mm");
    const content = (web.bodies[0] as { messages: Array<{ content: Array<{ type: string; text?: string }> }> })
      .messages[0]?.content;
    expect(content?.map((block) => block.type)).toEqual(["text"]);
    expect(content?.[0]?.text).toContain("klämma för kablarna");
  });

  it("leaves an idea that has a title alone, and one whose first words come later gets named then", async () => {
    const web = stubClaude();
    const titled = await capture({ title: "Benchy in silk", note: "the shiny one" });
    await uploadPhoto(titled, uuid(), cookie);
    // Nothing to read yet; then the first words arrive in the note.
    const later = await capture();
    expect(await rows()).toEqual([]);
    await asPerson(`/api/items/${later}`, { method: "PATCH", json: { note: "a lid for the tea tin" } });
    await settled();
    expect(await rows()).toMatchObject([{ item_id: later, status: "titled" }]);
    expect(web.bodies).toHaveLength(1);
    expect((await getItem(titled)).title).toBe("Benchy in silk");
    expect((await getItem(titled)).claudeTitle).toBeNull();
  });

  it("drops its answer when someone types a title while it works, and an edit makes the title theirs", async () => {
    stubClaude();
    const itemId = await capture({ note: "for the shelf above the printer" });
    // While it gives the capture a moment, the person names it.
    await asPerson(`/api/items/${itemId}`, { method: "PATCH", json: { title: "Shelf bracket" } });
    await settled();
    expect(await rows()).toMatchObject([{ status: "kept", run_outcome: "named_by_person" }]);
    expect(await getItem(itemId)).toMatchObject({ title: "Shelf bracket", claudeTitle: null });

    // Even when the title lands between Claude's call and its write, the person's stays.
    const raced = await capture({ note: "a hook for the headphones" });
    const db = getDb(env.DB);
    await env.DB.prepare("UPDATE item_titles SET claimed_at = ? WHERE item_id = ?").bind(Date.now(), raced).run();
    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      await env.DB.prepare("UPDATE items SET title = 'Headphone hook' WHERE id = ?").bind(raced).run();
      return Response.json({
        id: "msg_test",
        type: "message",
        role: "assistant",
        model: "claude-haiku-5-5",
        content: [{ type: "text", text: JSON.stringify({ title: "Hook for the headphones" }) }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 10 },
      });
    });
    await env.DB.prepare("UPDATE item_titles SET claimed_at = NULL WHERE item_id = ?").bind(raced).run();
    await runTitle(env, raced, db, { settleMs: 0 });
    expect((await getItem(raced)).title).toBe("Headphone hook");
    expect((await getItem(raced)).claudeTitle).toBeNull();

    // Editing Claude's title makes it the person's: it is no longer marked.
    vi.restoreAllMocks();
    stubClaude({ title: "Lid for the tea tin" });
    const named = await capture({ note: "the tea tin lost its lid" });
    await vi.waitFor(async () => expect((await getItem(named)).claudeTitle).toBe("Lid for the tea tin"), {
      timeout: 8000,
    });
    await asPerson(`/api/items/${named}`, { method: "PATCH", json: { title: "Tea tin lid, hinged" } });
    expect(await getItem(named)).toMatchObject({ title: "Tea tin lid, hinged", claudeTitle: null });
  }, 20_000);

  it("tells the screens it is naming an idea, and when it is done, through the item and the feed", async () => {
    stubClaude({ stopReason: "refusal" });
    const itemId = await capture({ note: "a ring for the curtain" });
    // At once the idea says Claude is naming it.
    const naming = (await getItem(itemId)).titleJob;
    expect(naming?.status).toBe("naming");
    expect(Math.abs((naming?.since ?? 0) - Date.now())).toBeLessThan(5000);
    const before = await (await asPerson("/api/changes?after=0")).json<{ changes: Array<{ seq: number }> }>();
    await settled();
    // A refusal leaves it untitled, says it is done, and the feed tells the screens so the sign stops at once.
    expect((await getItem(itemId)).titleJob).toMatchObject({ status: "done" });
    const after = await (await asPerson(`/api/changes?after=${before.changes.at(-1)?.seq ?? 0}`)).json<{
      changes: Array<{ entity: string; id: string }>;
    }>();
    expect(after.changes.some((c) => c.entity === "item" && c.id === itemId)).toBe(true);
    // An idea that was never asked about, or one with a title, has none.
    const titled = await capture({ title: "Curtain ring" });
    expect((await getItem(titled)).titleJob).toBeNull();
  });

  it("leaves an idea that became a build while it waited", async () => {
    const web = stubClaude();
    const itemId = await capture({ note: "a bracket for the shelf" });
    await asPerson(`/api/items/${itemId}`, { method: "PATCH", json: { stage: "building" } });
    await settled();
    expect(await rows()).toMatchObject([{ status: "kept", run_outcome: "not_an_idea" }]);
    expect(web.bodies).toHaveLength(0);
    expect((await getItem(itemId)).title).toBeNull();
  });

  it("skips an idea with a model link: the page's draft names it", async () => {
    const web = stubClaude();
    const linked = await capture({ note: "https://www.thingiverse.com/thing:763622 for the bathroom" });
    await uploadPhoto(linked, uuid(), cookie);
    const withWords = await capture({ note: "the cable comb https://makerworld.com/en/models/123456" });
    expect(await rows()).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(web.bodies).toHaveLength(0);
    expect((await getItem(linked)).title).toBeNull();
    expect((await getItem(withWords)).title).toBeNull();
  });

  it("does nothing without the key, and says so in the features", async () => {
    const web = stubClaude();
    const bare = { ...env, ANTHROPIC_API_KEY: undefined } as unknown as Env;
    const itemId = uuid();
    const made = await app.fetch(
      new Request(`${ORIGIN}/api/items`, {
        method: "POST",
        headers: { Cookie: cookie, Origin: ORIGIN, "Content-Type": "application/json" },
        body: JSON.stringify({ id: itemId, note: "a stand for the phone" }),
      }),
      bare,
      { waitUntil: () => undefined, passThroughOnException: () => undefined, props: {} } as unknown as ExecutionContext,
    );
    expect(made.status).toBe(201);
    expect(await rows()).toEqual([]);
    expect(await resumeTitles(bare)).toBe(0);
    expect(web.bodies).toHaveLength(0);
    const features = await app.fetch(new Request(`${ORIGIN}/api/features`, { headers: { Cookie: cookie } }), bare);
    expect((await features.json<FeaturesResponse>()).titles).toBe(false);
    expect((await (await asPerson("/api/features")).json<FeaturesResponse>()).titles).toBe(true);
  });

  it("keeps the idea as it was after a refusal, a failed call or no answer, and records why", async () => {
    stubClaude({ stopReason: "refusal" });
    await capture({ note: "something odd" });
    await settled();
    expect(await rows()).toMatchObject([{ status: "failed", run_outcome: "refusal" }]);

    await resetDb();
    await addUser("alex", "correct horse", "Alex Rivera", "tomato");
    cookie = await signIn("alex", "correct horse");
    vi.restoreAllMocks();
    stubClaude({ status: 500 });
    const failed = await capture({ note: "a thing for the desk" });
    await settled();
    expect(await rows()).toMatchObject([{ status: "failed", run_outcome: "api_error" }]);
    expect(JSON.parse(String((await rows())[0]?.detail))).toMatchObject({ httpStatus: 500 });
    expect((await getItem(failed)).title).toBeNull();

    await resetDb();
    await addUser("alex", "correct horse", "Alex Rivera", "tomato");
    cookie = await signIn("alex", "correct horse");
    vi.restoreAllMocks();
    // A vague answer is as good as none.
    stubClaude({ title: "3D print idea" });
    const vague = await capture({ note: "hmm" });
    await settled();
    expect(await rows()).toMatchObject([{ status: "none", run_outcome: "none" }]);
    expect((await getItem(vague)).title).toBeNull();
  }, 20_000);

  it("is started by people and their sharing token, never by an agent that can do more", async () => {
    stubClaude();
    const made = await asPerson("/api/agents", {
      method: "POST",
      json: { name: "Claude", scopes: ["capture", "read"] },
    });
    const { token } = await made.json<NewTokenResponse>();
    const itemId = uuid();
    await request("/api/items", {
      method: "POST",
      json: { id: itemId, note: "a stand for the phone" },
      headers: { Authorization: `Bearer ${token}`, Origin: "http://agent.test" },
    });
    expect(await rows()).toEqual([]);

    const sharing = await asPerson("/api/agents", { method: "POST", json: { name: "Shortcut", scopes: ["capture"] } });
    const shared = await request("/api/capture", {
      method: "POST",
      json: { text: "a hook for the bag" },
      headers: { Authorization: `Bearer ${(await sharing.json<NewTokenResponse>()).token}`, Origin: "http://x.test" },
    });
    expect(shared.status).toBe(201);
    await settled();
    expect(await rows()).toMatchObject([{ status: "titled" }]);
  });

  it("is picked up by the cron when the Worker was recycled, and given up on after two tries", async () => {
    stubClaude();
    env.TITLES_ON_SAVE = "off";
    const itemId = await capture({ note: "a clip for the bag" });
    const db = getDb(env.DB);
    expect(await startTitle(db, itemId)).toBe(true);
    // Started once is started for good.
    expect(await startTitle(db, itemId)).toBe(false);
    expect(await resumeTitles(env)).toBe(1);
    expect((await getItem(itemId)).title).toBe("Spool holder for the shelf");

    const lost = await capture({ note: "a clip for the cable" });
    await startTitle(db, lost);
    const long = Date.now() - STALE_MS - 1000;
    await env.DB.prepare("UPDATE item_titles SET claimed_at = ?, tries = 2 WHERE item_id = ?").bind(long, lost).run();
    expect(await resumeTitles(env)).toBe(1);
    expect((await rows()).find((row) => row.item_id === lost)).toMatchObject({
      status: "failed",
      run_outcome: "timeout",
    });
  });

  it("stops at the day's cap", async () => {
    stubClaude();
    env.TITLES_ON_SAVE = "off";
    const now = Date.now();
    const db = getDb(env.DB);
    for (let i = 0; i < TITLES_PER_DAY; i++) {
      const id = await capture({ title: `Idea ${i}` });
      await env.DB.prepare("INSERT INTO item_titles (item_id, status, created_at, ran_at) VALUES (?, 'titled', ?, ?)")
        .bind(id, now, now)
        .run();
    }
    const itemId = await capture({ note: "one more" });
    await startTitle(db, itemId);
    await runTitle(env, itemId, db, { settleMs: 0 });
    expect((await rows()).find((row) => row.item_id === itemId)).toMatchObject({
      status: "failed",
      run_outcome: "cap",
    });
  });
});

describe("cleanTitle", () => {
  it("keeps plain words and drops what isn't a title", () => {
    expect(cleanTitle('"spool holder for the shelf."')).toBe("Spool holder for the shelf");
    expect(cleanTitle("  Cable clip,\n 6 mm ")).toBe("Cable clip, 6 mm");
    expect(cleanTitle("Untitled")).toBeNull();
    expect(cleanTitle("3D print idea")).toBeNull();
    expect(cleanTitle(null)).toBeNull();
    expect(cleanTitle("A".repeat(80))).toBeNull();
  });
});
