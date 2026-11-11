import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NewTokenResponse } from "../../src/shared/agents.ts";
import type { AttemptResponse, FeaturesResponse, ItemResponse } from "../../src/shared/api.ts";
import { PHOTO_READS_PER_DAY } from "../../src/shared/photo-read.ts";
import { app } from "../../src/worker/app.ts";
import { resumeReads, STALE_MS } from "../../src/worker/photo-read/run.ts";
import { addUser, ORIGIN, request, resetDb, signIn, uploadPhoto } from "./helpers.ts";

type Answer = { json?: unknown; stopReason?: string; status?: number };

const spaghetti = {
  outcome: "failed",
  failureTags: ["spaghetti", "bed-adhesion"],
  successNotes: ["nice-surface"],
  reason: "Loose strands across the top half; looks like it lost adhesion early.",
};

/** Stubs the Anthropic API; Responses are made inside the stub (a Response can't cross requests). */
function stubClaude(answer: Answer | (() => Answer) = { json: spaghetti }) {
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
      model: "claude-opus-5-5",
      content: next.stopReason === "refusal" ? [] : [{ type: "text", text: JSON.stringify(next.json) }],
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
});
afterEach(() => vi.restoreAllMocks());

const uuid = () => crypto.randomUUID();
const asPerson = (path: string, init: Parameters<typeof request>[1] = {}) => request(path, { cookie, ...init });

async function makeToken(scopes: string[]) {
  const made = await asPerson("/api/agents", { method: "POST", json: { name: "An agent", scopes } });
  return (await made.json<NewTokenResponse>()).token;
}
const asToken = (token: string, path: string, init: RequestInit & { json?: unknown } = {}) =>
  request(path, { ...init, headers: { Authorization: `Bearer ${token}`, Origin: "http://agent.test" } });

/** A build with an attempt that has no outcome yet. */
async function startPrint(note = "") {
  const itemId = uuid();
  const attemptId = uuid();
  await asPerson("/api/items", { method: "POST", json: { id: itemId, stage: "building", title: "Cable comb" } });
  await asPerson(`/api/items/${itemId}/attempts`, { method: "POST", json: { id: attemptId, note } });
  return { itemId, attemptId };
}
const getAttempt = async (itemId: string, attemptId: string) =>
  (await (await asPerson(`/api/items/${itemId}`)).json<ItemResponse>()).item.attempts.find((a) => a.id === attemptId);
/** Waits for the read that runs after the upload's response. */
const settled = (itemId: string, attemptId: string) =>
  vi.waitFor(
    async () => {
      const attempt = await getAttempt(itemId, attemptId);
      expect(attempt?.photoRead?.status).not.toBe("reading");
      return attempt;
    },
    { timeout: 5000 },
  );
const rows = async () => (await env.DB.prepare("SELECT * FROM photo_reads").all()).results;

describe("reading a print from its photo", () => {
  it("suggests an outcome, tags and a reason, and never sets the outcome itself", async () => {
    const web = stubClaude();
    const { itemId, attemptId } = await startPrint();
    const upload = await uploadPhoto(itemId, uuid(), cookie, { attemptId });
    expect(upload.status).toBe(201);
    // At once the attempt says it is looking.
    expect((await getAttempt(itemId, attemptId))?.photoRead?.status).toBe("reading");
    const attempt = await settled(itemId, attemptId);
    expect(attempt?.photoRead).toMatchObject({
      status: "read",
      outcome: "failed",
      // A failure has no success notes.
      failureTags: ["spaghetti", "bed-adhesion"],
      successNotes: [],
      reason: "Loose strands across the top half; looks like it lost adhesion early.",
    });
    expect(attempt).toMatchObject({ outcome: null, failureTags: [], successNotes: [], note: "" });
    // The photo went in as an image, and the answer is constrained to the built-in tags.
    const request0 = web.bodies[0] as {
      model: string;
      output_config: { format: { schema: unknown } };
      messages: Array<{ content: Array<{ type: string }> }>;
    };
    expect(request0.model).toBe("claude-opus-5-5");
    expect(request0.messages[0]?.content[0]?.type).toBe("image");
    expect(JSON.stringify(request0.output_config.format.schema)).toContain('"bed-adhesion"');
    // The run is on record.
    expect(await rows()).toMatchObject([{ status: "read", run_outcome: "read" }]);
    // And the other person's feed said so.
    const feed = await (await asPerson("/api/changes?after=0")).json<{
      changes: Array<{ entity: string; id: string }>;
    }>();
    expect(feed.changes.filter((c) => c.entity === "attempt" && c.id === attemptId).length).toBeGreaterThan(1);
  });

  it("suggests nothing when Claude can't tell, and leaves nothing in the way", async () => {
    stubClaude({ json: { outcome: null, failureTags: [], successNotes: [], reason: null } });
    const { itemId, attemptId } = await startPrint();
    await uploadPhoto(itemId, uuid(), cookie, { attemptId });
    await vi.waitFor(async () => expect(await rows()).toMatchObject([{ status: "unsure" }]));
    expect((await getAttempt(itemId, attemptId))?.photoRead).toBeNull();
  });

  it("suggests nothing after a refusal or a failed call, and records why", async () => {
    stubClaude({ stopReason: "refusal" });
    const one = await startPrint();
    await uploadPhoto(one.itemId, uuid(), cookie, { attemptId: one.attemptId });
    await vi.waitFor(async () => expect(await rows()).toMatchObject([{ status: "failed", run_outcome: "refusal" }]));
    expect((await getAttempt(one.itemId, one.attemptId))?.photoRead).toBeNull();

    vi.restoreAllMocks();
    stubClaude({ status: 500 });
    const two = await startPrint();
    await uploadPhoto(two.itemId, uuid(), cookie, { attemptId: two.attemptId });
    await vi.waitFor(async () =>
      expect(await rows()).toMatchObject([{ run_outcome: "refusal" }, { status: "failed", run_outcome: "api_error" }]),
    );
    const detail = JSON.parse(String((await rows())[1]?.detail));
    expect(detail).toMatchObject({ httpStatus: 500, model: "claude-opus-5-5" });
  });

  it("doesn't look when there's no key, or the attempt already has its outcome", async () => {
    const web = stubClaude();
    const bare = { ...env, ANTHROPIC_API_KEY: undefined } as unknown as Env;
    const features = await app.fetch(new Request(`${ORIGIN}/api/features`, { headers: { Cookie: cookie } }), bare);
    expect((await features.json<FeaturesResponse>()).photoReads).toBe(false);
    expect((await (await asPerson("/api/features")).json<FeaturesResponse>()).photoReads).toBe(true);

    const { itemId, attemptId } = await startPrint();
    await asPerson(`/api/attempts/${attemptId}`, { method: "PATCH", json: { outcome: "success" } });
    await uploadPhoto(itemId, uuid(), cookie, { attemptId });
    // A photo of the item itself isn't read either.
    await uploadPhoto(itemId, uuid(), cookie);
    expect(await rows()).toHaveLength(0);
    expect(web.bodies).toHaveLength(0);
  });

  it("drops the suggestion once someone says how it went, without touching their words", async () => {
    stubClaude();
    const { itemId, attemptId } = await startPrint();
    await uploadPhoto(itemId, uuid(), cookie, { attemptId });
    await settled(itemId, attemptId);
    const finished = await asPerson(`/api/attempts/${attemptId}`, {
      method: "PATCH",
      json: { outcome: "partial", failureTags: ["warping"] },
    });
    const { attempt } = await finished.json<AttemptResponse>();
    expect(attempt).toMatchObject({ outcome: "partial", failureTags: ["warping"], photoRead: null });
  });

  it("never reads the same photo twice, and a newer photo replaces the suggestion", async () => {
    let next: Answer = { json: spaghetti };
    const web = stubClaude(() => next);
    const { itemId, attemptId } = await startPrint();
    const first = uuid();
    await uploadPhoto(itemId, first, cookie, { attemptId });
    await settled(itemId, attemptId);
    // The same upload again (a retry) changes nothing.
    await uploadPhoto(itemId, first, cookie, { attemptId });
    expect(web.bodies).toHaveLength(1);

    next = {
      json: { outcome: "success", failureTags: ["spaghetti"], successNotes: ["nice-surface"], reason: "Clean top." },
    };
    await new Promise((resolve) => setTimeout(resolve, 5));
    await uploadPhoto(itemId, uuid(), cookie, { attemptId });
    const attempt = await vi.waitFor(async () => {
      const found = await getAttempt(itemId, attemptId);
      expect(found?.photoRead).toMatchObject({ status: "read", outcome: "success" });
      return found;
    });
    // A success has no failure tags.
    expect(attempt?.photoRead).toMatchObject({ failureTags: [], successNotes: ["nice-surface"], reason: "Clean top." });
    expect(web.bodies).toHaveLength(2);
  });

  it("is capped per day for the workspace", async () => {
    const web = stubClaude();
    const { itemId, attemptId } = await startPrint();
    for (let i = 0; i < PHOTO_READS_PER_DAY; i++) {
      await uploadPhoto(itemId, uuid(), cookie, { attemptId });
      await vi.waitFor(async () => expect((await rows()).every((r) => r.status !== "reading")).toBe(true));
    }
    expect(web.bodies).toHaveLength(PHOTO_READS_PER_DAY);
    web.bodies.length = 0;
    await uploadPhoto(itemId, uuid(), cookie, { attemptId });
    await vi.waitFor(async () => expect((await rows()).some((r) => r.run_outcome === "cap")).toBe(true));
    expect(web.bodies).toHaveLength(0);
  });

  it("starts from a person's photo and from the bridge's, but not from other agents", async () => {
    stubClaude();
    const { itemId, attemptId } = await startPrint();
    const bridge = await makeToken(["read", "attempts", "printer"]);
    const claude = await makeToken(["read", "capture", "attempts"]);
    const send = (token: string, photoId: string) => {
      const form = new FormData();
      for (const [key, value] of Object.entries({
        width: "1920",
        height: "1080",
        color: "#808080",
        attemptId,
        needsResize: "1",
      })) {
        form.set(key, value);
      }
      form.set("large", new File([new Uint8Array([1, 2, 3])], "frame.jpg", { type: "image/jpeg" }));
      form.set("thumb", new File([new Uint8Array([1, 2, 3])], "frame.jpg", { type: "image/jpeg" }));
      return asToken(token, `/api/items/${itemId}/photos/${photoId}`, { method: "PUT", body: form });
    };
    expect((await send(claude, uuid())).status).toBe(201);
    expect(await rows()).toHaveLength(0);
    expect((await send(bridge, uuid())).status).toBe(201);
    await vi.waitFor(async () => expect(await rows()).toMatchObject([{ status: "read" }]));
  });

  it("picks up a read nobody is working on any more, and gives up on one that keeps getting lost", async () => {
    const web = stubClaude();
    const { itemId, attemptId } = await startPrint();
    const photoId = uuid();
    await uploadPhoto(itemId, photoId, cookie, { attemptId });
    await settled(itemId, attemptId);
    web.bodies.length = 0;
    // Put it back as if the Worker was lost mid-read, twice.
    await env.DB.prepare("UPDATE photo_reads SET status = 'reading', claimed_at = ?, tries = 1 WHERE photo_id = ?")
      .bind(Date.now() - STALE_MS - 1000, photoId)
      .run();
    expect(await resumeReads(env)).toBe(1);
    expect(web.bodies).toHaveLength(1);
    await env.DB.prepare("UPDATE photo_reads SET status = 'reading', claimed_at = ?, tries = 2 WHERE photo_id = ?")
      .bind(Date.now() - STALE_MS - 1000, photoId)
      .run();
    expect(await resumeReads(env)).toBe(1);
    expect(await rows()).toMatchObject([{ status: "failed", run_outcome: "timeout" }]);
  });
});
