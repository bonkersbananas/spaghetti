import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NewTokenResponse } from "../../src/shared/agents.ts";
import type { AttemptResponse, FeaturesResponse, ItemResponse } from "../../src/shared/api.ts";
import { COACH_PER_DAY } from "../../src/shared/coach.ts";
import { coachTiming, resumeCoaches, runCoach, STALE_MS } from "../../src/worker/coach/run.ts";
import { addUser, request, resetDb, signIn, uploadPhoto } from "./helpers.ts";

type Answer = { json?: unknown; stopReason?: string; status?: number };

const none = {
  bedTemperature: null,
  nozzleTemperature: null,
  chamberTemperature: null,
  brim: null,
  supportEnabled: null,
  supportType: null,
  layerHeight: null,
  infillDensity: null,
  wallLoops: null,
  filamentDried: null,
  bedType: null,
  nozzleDiameter: null,
};
const good = {
  suggestions: [
    { title: "Add a brim", why: "The stern lifted both times.", change: { ...none, brim: true }, note: null },
    // Beyond what the X2D can do: dropped, not trimmed to fit.
    { title: "Bed to 150", why: "Hotter sticks better.", change: { ...none, bedTemperature: 150 }, note: null },
    { title: "Slow the outer wall to 60 mm/s", why: "Fine strings.", change: null, note: "Outer wall 60 mm/s" },
    // Already how it was printed: nothing to do.
    { title: "Bed at 60", why: "Already.", change: { ...none, bedTemperature: 60 }, note: null },
  ],
};

function stubClaude(answer: Answer | (() => Answer) = { json: good }) {
  const bodies: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname !== "api.anthropic.com") return new Response("nope", { status: 404 });
    bodies.push(String(init?.body));
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
const originalTiming = { ...coachTiming };
beforeEach(async () => {
  // Most tests want the coach to think at once; the ones about waiting set their own.
  coachTiming.quietMs = 0;
  coachTiming.waitMs = 0;
  await resetDb();
  await addUser("alex", "correct horse", "Alex Rivera", "tomato");
  cookie = await signIn("alex", "correct horse");
});
afterEach(() => {
  vi.restoreAllMocks();
  Object.assign(coachTiming, originalTiming);
});

const uuid = () => crypto.randomUUID();
const asPerson = (path: string, init: Parameters<typeof request>[1] = {}) => request(path, { cookie, ...init });
async function makeToken(scopes: string[]) {
  const made = await asPerson("/api/agents", { method: "POST", json: { name: "An agent", scopes } });
  return (await made.json<NewTokenResponse>()).token;
}
const asToken = (token: string, path: string, init: RequestInit & { json?: unknown } = {}) =>
  request(path, { ...init, headers: { Authorization: `Bearer ${token}`, Origin: "http://agent.test" } });

/** A build with a printing attempt, printed on PETG at 60 °C. */
async function startPrint() {
  const itemId = uuid();
  const attemptId = uuid();
  await asPerson("/api/items", { method: "POST", json: { id: itemId, stage: "building", title: "Cable comb" } });
  await asPerson(`/api/items/${itemId}/attempts`, {
    method: "POST",
    json: {
      id: attemptId,
      note: "corner lifted",
      settings: { filaments: [{ type: "PETG" }], bedTemperature: 60 },
    },
  });
  return { itemId, attemptId };
}
const getAttempt = async (itemId: string, attemptId: string) =>
  (await (await asPerson(`/api/items/${itemId}`)).json<ItemResponse>()).item.attempts.find((a) => a.id === attemptId);
const settled = (itemId: string, attemptId: string) =>
  vi.waitFor(
    async () => {
      const attempt = await getAttempt(itemId, attemptId);
      expect(attempt?.coach?.status).not.toBe("thinking");
      return attempt;
    },
    { timeout: 5000 },
  );
const answer = (attemptId: string, outcome: string, as = asPerson) =>
  as(`/api/attempts/${attemptId}`, { method: "PATCH", json: { outcome } });

describe("the failure coach", () => {
  it("suggests what to try after a Spaghetti answer, cleaned to what the printer has, and sets nothing", async () => {
    const { bodies } = stubClaude();
    const { itemId, attemptId } = await startPrint();
    const res = await answer(attemptId, "failed");
    // It says it is thinking at once, in the very answer.
    expect((await res.json<AttemptResponse>()).attempt.coach).toEqual({ status: "thinking", items: [] });
    const attempt = await settled(itemId, attemptId);
    expect(attempt?.coach?.status).toBe("ready");
    expect(attempt?.coach?.items.map((item) => [item.id, item.title, item.settings, item.note])).toEqual([
      ["s1", "Add a brim", { brim: true }, null],
      ["s2", "Slow the outer wall to 60 mm/s", null, "Outer wall 60 mm/s"],
    ]);
    // Only suggested: the attempt's own settings, note and tags are untouched.
    expect(attempt?.settings).toEqual({ filaments: [{ type: "PETG" }], bedTemperature: 60 });
    expect(attempt?.note).toBe("corner lifted");
    expect(attempt?.failureTags).toEqual([]);
    // Agents read it in the build's story, marked as only suggestions.
    const story = await (await asPerson(`/api/builds/${itemId}/story.md`)).text();
    expect(story).toContain(
      "Claude suggests for the next try (only suggestions, nothing was changed): Add a brim (The stern lifted both times); Slow the outer wall to 60 mm/s (Fine strings).",
    );
    // It was told about the attempt and the printer, not asked for a photo.
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain("Cable comb");
    expect(bodies[0]).toContain("corner lifted");
    expect(bodies[0]).toContain("Bambu Lab X2D");
    expect(bodies[0]).toContain("claude-opus-5-5");
  });

  it("also coaches an attempt logged as Partly, and one finished from a notification", async () => {
    stubClaude();
    const itemId = uuid();
    await asPerson("/api/items", { method: "POST", json: { id: itemId, stage: "building" } });
    const logged = uuid();
    await asPerson(`/api/items/${itemId}/attempts`, { method: "POST", json: { id: logged, outcome: "partial" } });
    expect((await settled(itemId, logged))?.coach?.status).toBe("ready");
    const printing = uuid();
    await asPerson(`/api/items/${itemId}/attempts`, { method: "POST", json: { id: printing } });
    await asPerson(`/api/attempts/${printing}/finish`, { method: "POST", json: { outcome: "failed" } });
    expect((await settled(itemId, printing))?.coach?.status).toBe("ready");
  });

  it("says nothing for a print that worked, and not again when only a note changes", async () => {
    const { bodies } = stubClaude();
    const { itemId, attemptId } = await startPrint();
    await answer(attemptId, "success");
    expect((await getAttempt(itemId, attemptId))?.coach).toBeNull();
    await answer(attemptId, "failed");
    await settled(itemId, attemptId);
    await asPerson(`/api/attempts/${attemptId}`, { method: "PATCH", json: { note: "still lifted" } });
    expect(bodies).toHaveLength(1);
    // Turned back into a success, the suggestions go quiet.
    await answer(attemptId, "success");
    expect((await getAttempt(itemId, attemptId))?.coach).toBeNull();
  });

  it("shows nothing when there is nothing useful to say, on a refusal or a failed call", async () => {
    for (const next of [
      { json: { suggestions: [] } },
      { stopReason: "refusal" },
      { status: 500 },
      { json: { oops: true } },
    ] satisfies Answer[]) {
      stubClaude(next);
      const { itemId, attemptId } = await startPrint();
      await answer(attemptId, "failed");
      expect((await settled(itemId, attemptId))?.coach).toBeNull();
      vi.restoreAllMocks();
    }
    const row = await env.DB.prepare("SELECT status, run_outcome FROM coach_runs ORDER BY created_at").all();
    expect(row.results.map((r) => r.run_outcome)).toEqual(["nothing", "refusal", "api_error", "bad_shape"]);
  });

  it("is capped per day for the workspace", async () => {
    const { bodies } = stubClaude();
    const { itemId, attemptId } = await startPrint();
    const now = Date.now();
    for (let i = 0; i < COACH_PER_DAY; i++) {
      const earlier = uuid();
      await asPerson(`/api/items/${itemId}/attempts`, { method: "POST", json: { id: earlier } });
      await env.DB.prepare(
        "INSERT INTO coach_runs (attempt_id, item_id, status, created_at, ran_at) VALUES (?, ?, 'nothing', ?, ?)",
      )
        .bind(earlier, itemId, now, now)
        .run();
    }
    await answer(attemptId, "failed");
    expect((await settled(itemId, attemptId))?.coach).toBeNull();
    expect(bodies).toHaveLength(0);
  });

  it("does nothing without the key", async () => {
    stubClaude();
    const features = await asPerson("/api/features");
    expect((await features.json<FeaturesResponse>()).coach).toBe(true);
    const { itemId, attemptId } = await startPrint();
    const original = env.ANTHROPIC_API_KEY;
    // Only the Worker's own view of the key changes: a request made now sees no key.
    (env as { ANTHROPIC_API_KEY?: string }).ANTHROPIC_API_KEY = "";
    try {
      expect((await (await asPerson("/api/features")).json<FeaturesResponse>()).coach).toBe(false);
      const res = await answer(attemptId, "failed");
      expect((await res.json<AttemptResponse>()).attempt.coach).toBeNull();
    } finally {
      (env as { ANTHROPIC_API_KEY?: string }).ANTHROPIC_API_KEY = original;
    }
    expect((await getAttempt(itemId, attemptId))?.coach).toBeNull();
  });

  it("is for people: an agent's answer isn't coached, the bridge's is", async () => {
    const { bodies } = stubClaude();
    const agent = await makeToken(["attempts"]);
    const { itemId, attemptId } = await startPrint();
    const res = await answer(attemptId, "failed", (path, init) => asToken(agent, path, init));
    expect(res.status).toBe(200);
    expect((await res.json<AttemptResponse>()).attempt.coach).toBeNull();
    expect(bodies).toHaveLength(0);
    expect((await getAttempt(itemId, attemptId))?.coach).toBeNull();

    const bridge = await makeToken(["read", "attempts", "printer"]);
    const second = await startPrint();
    await answer(second.attemptId, "partial", (path, init) => asToken(bridge, path, init));
    expect((await settled(second.itemId, second.attemptId))?.coach?.status).toBe("ready");
  });

  it("dismisses a suggestion for good (for both people), and takes it back; people only", async () => {
    stubClaude();
    const { itemId, attemptId } = await startPrint();
    await answer(attemptId, "failed");
    await settled(itemId, attemptId);
    const dismiss = (dismissed: boolean) =>
      asPerson(`/api/attempts/${attemptId}/coach/s1`, { method: "PUT", json: { dismissed } });
    const res = await dismiss(true);
    expect((await res.json<AttemptResponse>()).attempt.coach?.items.map((i) => [i.id, i.dismissed])).toEqual([
      ["s1", true],
      ["s2", false],
    ]);
    // Still dismissed on the next read, and the change feed says so.
    expect((await getAttempt(itemId, attemptId))?.coach?.items[0]?.dismissed).toBe(true);
    expect((await dismiss(true)).status).toBe(200);
    expect((await (await dismiss(false)).json<AttemptResponse>()).attempt.coach?.items[0]?.dismissed).toBe(false);
    expect(
      (await asPerson(`/api/attempts/${attemptId}/coach/nope`, { method: "PUT", json: { dismissed: true } })).status,
    ).toBe(404);
    const agent = await makeToken(["read", "attempts", "printer", "capture"]);
    const refused = await asToken(agent, `/api/attempts/${attemptId}/coach/s1`, {
      method: "PUT",
      json: { dismissed: true },
    });
    expect(refused.status).toBe(403);
  });

  it("picks up a coach nobody is working on, twice at most", async () => {
    stubClaude({ status: 500 });
    const { itemId, attemptId } = await startPrint();
    await env.DB.prepare(
      "INSERT INTO coach_runs (attempt_id, item_id, status, created_at, tries) VALUES (?, ?, 'thinking', ?, 2)",
    )
      .bind(attemptId, itemId, Date.now() - STALE_MS - 1000)
      .run();
    await env.DB.prepare("UPDATE attempts SET outcome = 'failed' WHERE id = ?").bind(attemptId).run();
    expect(await resumeCoaches(env as never)).toBe(1);
    const row = await env.DB.prepare("SELECT status, run_outcome FROM coach_runs").first();
    expect(row).toEqual({ status: "failed", run_outcome: "timeout" });
  });

  describe("waits for the whole answer", () => {
    const MIN = 60_000;
    /** Moves everything about the attempt back in time, as if it had all happened `ago` ms ago. */
    const age = async (attemptId: string, ago: number) => {
      const then = Date.now() - ago;
      await env.DB.prepare("UPDATE coach_runs SET created_at = ? WHERE attempt_id = ?").bind(then, attemptId).run();
      await env.DB.prepare("UPDATE attempts SET updated_at = ? WHERE id = ?").bind(then, attemptId).run();
      await env.DB.prepare("UPDATE photos SET created_at = ? WHERE attempt_id = ?").bind(then, attemptId).run();
    };
    const runs = async (attemptId: string) =>
      (await env.DB.prepare("SELECT status, runs FROM coach_runs WHERE attempt_id = ?").bind(attemptId).first()) as {
        status: string;
        runs: number;
      };
    /** Photos of the attempt that reached Claude in a call's body. */
    const images = (body: string | undefined) =>
      (
        JSON.parse(body ?? "{}") as { messages: Array<{ content: Array<{ type: string }> }> }
      ).messages[0]?.content.filter((part) => part.type === "image").length;

    it("doesn't think while the answer is still coming in, then does with the note and the close-ups", async () => {
      coachTiming.quietMs = MIN;
      const { bodies } = stubClaude();
      const { itemId, attemptId } = await startPrint();
      await answer(attemptId, "partial");
      // Thinking is shown at once, but nothing was asked yet.
      expect((await getAttempt(itemId, attemptId))?.coach?.status).toBe("thinking");
      await asPerson(`/api/attempts/${attemptId}`, {
        method: "PATCH",
        json: { note: "Top layer fine, the bottom layer really messy", failureTags: ["stringing"] },
      });
      expect((await uploadPhoto(itemId, uuid(), cookie, { attemptId })).status).toBe(201);
      expect((await uploadPhoto(itemId, uuid(), cookie, { attemptId })).status).toBe(201);
      await vi.waitFor(async () => expect(await runs(attemptId)).toMatchObject({ status: "thinking", runs: 0 }));
      // The cron comes by while they are still adding: still not.
      expect(await resumeCoaches(env as never)).toBe(1);
      expect(bodies).toHaveLength(0);
      // A minute and a half of quiet later it thinks, with the note and the photos.
      await age(attemptId, 90_000);
      await resumeCoaches(env as never);
      expect((await settled(itemId, attemptId))?.coach?.status).toBe("ready");
      expect(bodies).toHaveLength(1);
      expect(bodies[0]).toContain("Top layer fine, the bottom layer really messy");
      expect(bodies[0]).toContain("Pictures of this print are attached (2)");
      expect(images(bodies[0])).toBe(2);
    });

    it("puts their close-ups ahead of the printer's camera frame, and looks at three pictures at most", async () => {
      const { bodies } = stubClaude();
      const { itemId, attemptId } = await startPrint();
      for (let i = 0; i < 3; i++) await uploadPhoto(itemId, uuid(), cookie, { attemptId });
      // The printer's frame arrives last, so it is the newest.
      const frame = uuid();
      await uploadPhoto(itemId, frame, cookie, { attemptId });
      await env.DB.prepare("UPDATE photos SET width = 1920, height = 1080 WHERE id = ?").bind(frame).run();
      await answer(attemptId, "partial");
      await settled(itemId, attemptId);
      // (The photos also had their own reads, before the answer.)
      const coachBody = bodies.find((body) => body.includes("What should they try"));
      expect(images(coachBody)).toBe(3);
      // The frame is the newest, yet left out for the three close-ups.
      expect(coachBody).toContain("their own close-ups first.");
      expect(coachBody).not.toContain("camera's wide frame");
    });

    it("says what is there when the only picture is the camera's frame", async () => {
      const { bodies } = stubClaude();
      const { itemId, attemptId } = await startPrint();
      const frame = uuid();
      await uploadPhoto(itemId, frame, cookie, { attemptId });
      await env.DB.prepare("UPDATE photos SET width = 1920, height = 1080 WHERE id = ?").bind(frame).run();
      await answer(attemptId, "partial");
      await settled(itemId, attemptId);
      const body = bodies.find((b) => b.includes("What should they try")) ?? "";
      expect(body).toContain("only the printer camera's wide frame");
      expect(body).not.toContain("close-ups first");
    });

    it("takes up what arrives after the first run, once, and keeps the first answer if that fails", async () => {
      const { bodies } = stubClaude();
      const { itemId, attemptId } = await startPrint();
      await answer(attemptId, "failed");
      await settled(itemId, attemptId);
      expect(bodies).toHaveLength(1);
      expect(await runs(attemptId)).toMatchObject({ status: "done", runs: 1 });
      // Nothing new: the cron has nothing to do.
      await resumeCoaches(env as never);
      expect(bodies).toHaveLength(1);
      // A note and a photo arrive after it: one more look.
      await asPerson(`/api/attempts/${attemptId}`, { method: "PATCH", json: { note: "bottom layer messy" } });
      await uploadPhoto(itemId, uuid(), cookie, { attemptId });
      await resumeCoaches(env as never);
      expect(bodies).toHaveLength(2);
      expect(bodies[1]).toContain("bottom layer messy");
      expect(images(bodies[1])).toBe(1);
      expect(await runs(attemptId)).toMatchObject({ status: "done", runs: 2 });
      // And never a third, however much more is added.
      await asPerson(`/api/attempts/${attemptId}`, { method: "PATCH", json: { note: "bottom layer messy, again" } });
      await resumeCoaches(env as never);
      await runCoach(env as never, attemptId);
      expect(bodies).toHaveLength(2);
    });

    it("keeps its first suggestions when the second look fails, and dismissals reset when it replaces them", async () => {
      let next: Answer = { json: good };
      stubClaude(() => next);
      const { itemId, attemptId } = await startPrint();
      await answer(attemptId, "failed");
      await settled(itemId, attemptId);
      await asPerson(`/api/attempts/${attemptId}/coach/s1`, { method: "PUT", json: { dismissed: true } });
      await asPerson(`/api/attempts/${attemptId}`, { method: "PATCH", json: { note: "more" } });
      next = { status: 500 };
      await resumeCoaches(env as never);
      const kept = await getAttempt(itemId, attemptId);
      expect(kept?.coach?.items.map((i) => [i.id, i.dismissed])).toEqual([
        ["s1", true],
        ["s2", false],
      ]);
      expect(await runs(attemptId)).toMatchObject({ status: "done", runs: 2 });

      const other = await startPrint();
      next = { json: good };
      await answer(other.attemptId, "failed");
      await settled(other.itemId, other.attemptId);
      await asPerson(`/api/attempts/${other.attemptId}/coach/s1`, { method: "PUT", json: { dismissed: true } });
      await asPerson(`/api/attempts/${other.attemptId}`, { method: "PATCH", json: { note: "more" } });
      next = { json: { suggestions: [good.suggestions[0]] } };
      await resumeCoaches(env as never);
      expect((await getAttempt(other.itemId, other.attemptId))?.coach?.items.map((i) => [i.id, i.dismissed])).toEqual([
        ["r2-s1", false],
      ]);
    });

    it("doesn't take up a change an hour after the answer", async () => {
      const { bodies } = stubClaude();
      const { itemId, attemptId } = await startPrint();
      await answer(attemptId, "failed");
      await settled(itemId, attemptId);
      await asPerson(`/api/attempts/${attemptId}`, { method: "PATCH", json: { note: "much later" } });
      await age(attemptId, 61 * MIN);
      await resumeCoaches(env as never);
      expect(bodies).toHaveLength(1);
    });

    it("never runs twice at once", async () => {
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const bodies: string[] = [];
      vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
        bodies.push(String(init?.body));
        await gate;
        return Response.json({
          id: "msg_test",
          type: "message",
          role: "assistant",
          model: "claude-opus-5-5",
          content: [{ type: "text", text: JSON.stringify(good) }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
        });
      });
      const { itemId, attemptId } = await startPrint();
      await answer(attemptId, "failed");
      await vi.waitFor(() => expect(bodies).toHaveLength(1));
      // The cron and a second try arrive while the first is still with Claude.
      await Promise.all([resumeCoaches(env as never), runCoach(env as never, attemptId)]);
      expect(bodies).toHaveLength(1);
      release();
      await settled(itemId, attemptId);
      expect(bodies).toHaveLength(1);
    });

    it("keeps the first suggestions when the second look has nothing, and gives a second round ids of its own", async () => {
      let next: Answer = { json: good };
      stubClaude(() => next);
      const first = await startPrint();
      await answer(first.attemptId, "failed");
      await settled(first.itemId, first.attemptId);
      await asPerson(`/api/attempts/${first.attemptId}/coach/s1`, { method: "PUT", json: { dismissed: true } });
      await asPerson(`/api/attempts/${first.attemptId}`, { method: "PATCH", json: { note: "more" } });
      next = { json: { suggestions: [] } };
      await resumeCoaches(env as never);
      expect((await getAttempt(first.itemId, first.attemptId))?.coach?.items.map((i) => [i.id, i.dismissed])).toEqual([
        ["s1", true],
        ["s2", false],
      ]);
      expect(await runs(first.attemptId)).toMatchObject({ status: "done", runs: 2 });

      const second = await startPrint();
      next = { json: good };
      await answer(second.attemptId, "failed");
      await settled(second.itemId, second.attemptId);
      await asPerson(`/api/attempts/${second.attemptId}`, { method: "PATCH", json: { note: "more" } });
      await resumeCoaches(env as never);
      const items = (await getAttempt(second.itemId, second.attemptId))?.coach?.items ?? [];
      expect(items.map((i) => i.id)).toEqual(["r2-s1", "r2-s2"]);
      // A dismissal from a screen that still shows the first round finds nothing to hide.
      const stale = await asPerson(`/api/attempts/${second.attemptId}/coach/s1`, {
        method: "PUT",
        json: { dismissed: true },
      });
      expect(stale.status).toBe(404);
    });
  });
});
