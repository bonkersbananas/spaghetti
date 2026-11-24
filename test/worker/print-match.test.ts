import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NewTokenResponse } from "../../src/shared/agents.ts";
import type { AttemptResponse, PrintSuggestionsResponse } from "../../src/shared/api.ts";
import { PRINT_MATCHES_PER_DAY, runPrintMatch } from "../../src/worker/print-match/run.ts";
import { addUser, request, resetDb, signIn } from "./helpers.ts";

/** Made-up builds: a print the matcher can't place, and the builds Claude is asked about. */
type Answer = { pick?: string | null; reason?: string; status?: number; stopReason?: string };

/**
 * Stubs the Anthropic API. The answer names a build by its title; the stand-in finds the key the prompt gave it
 * ("[c2] Desk light").
 */
function stubClaude(answer: Answer = {}) {
  const prompts: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname !== "api.anthropic.com") return new Response("nope", { status: 404 });
    const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
    const prompt = body.messages[0]?.content ?? "";
    prompts.push(prompt);
    if (answer.status) {
      return Response.json({ type: "error", error: { type: "api_error", message: "no" } }, { status: answer.status });
    }
    const title = answer.pick;
    const key = title ? (prompt.match(new RegExp(`\\[(c\\d+)\\] ${title}`))?.[1] ?? "c99") : null;
    return Response.json({
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: "claude-opus-5-5",
      content:
        answer.stopReason === "refusal"
          ? []
          : [{ type: "text", text: JSON.stringify({ pick: key, reason: answer.reason ?? "" }) }],
      stop_reason: answer.stopReason ?? "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 10 },
    });
  });
  return { prompts };
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let cookie: string;
let token: string;
const uuid = () => crypto.randomUUID();
const asBridge = (path: string, init: RequestInit & { json?: unknown } = {}) =>
  request(path, { ...init, headers: { Authorization: `Bearer ${token}`, Origin: "http://printer.test" } });

beforeEach(async () => {
  await resetDb();
  await addUser("sam", "correct horse", "Sam Lind", "sea");
  cookie = await signIn("sam", "correct horse");
  const made = await request("/api/agents", {
    method: "POST",
    json: { name: "Printer bridge", scopes: ["read", "attempts", "printer"] },
    cookie,
  });
  token = (await made.json<NewTokenResponse>()).token;
  await asBridge("/api/printer/bridge", { method: "PUT", json: { printerState: "idle", progress: null } });
});
afterEach(() => vi.restoreAllMocks());

async function build(title: string, stage: "building" | "idea" = "building") {
  const id = uuid();
  await request("/api/items", { method: "POST", cookie, json: { id, title, stage } });
  await env.DB.prepare("UPDATE items SET started_at = ? WHERE id = ?")
    .bind(Date.now() - 26 * 60 * 60_000, id)
    .run();
  return id;
}

/** What the bridge does for a print: a build named after it, then the attempt in that build. */
async function bridgePrints(name: string) {
  const ownId = uuid();
  const attemptId = uuid();
  await asBridge("/api/items", { method: "POST", json: { id: ownId, title: name, stage: "building" } });
  const response = await asBridge(`/api/items/${ownId}/attempts`, {
    method: "POST",
    json: { id: attemptId, printedAt: Date.now(), print: { name, plate: 1, estimateMinutes: 48 } },
  });
  expect(response.status).toBe(201);
  return { ownId, attemptId, attempt: (await response.json<AttemptResponse>()).attempt };
}

const suggestions = async (attemptId: string) =>
  (await (await request(`/api/attempts/${attemptId}/suggestions`, { cookie })).json<PrintSuggestionsResponse>())
    .suggestions;
const runs = async () => (await env.DB.prepare("SELECT * FROM print_match_runs").all()).results;
const settled = () =>
  vi.waitFor(
    async () => {
      const [row] = await runs();
      expect(row?.status).toBeDefined();
      expect(row?.status).not.toBe("asking");
      return row;
    },
    { timeout: 5000 },
  );

describe("Claude's second opinion on a print", () => {
  it("is asked once when the matcher isn't sure, and its pick leads the question with its reason", async () => {
    const web = stubClaude({ pick: "Desk light", reason: "Its last prints were lamp shades like this one." });
    const desk = await build("Desk light");
    const shelf = await build("Shelf brackets");
    // The matcher finds the shelf's name in it but isn't sure (no file, not started just before); nothing for the desk light.
    const { attemptId, attempt } = await bridgePrints("Shelf-bracket-v2-print");
    expect(attempt.print).toMatchObject({ placed: "new", asking: true });

    const run = await settled();
    expect(run).toMatchObject({ status: "picked", item_id: desk, run_outcome: "picked" });
    expect(JSON.parse(String(run?.candidate_ids))).toEqual(expect.arrayContaining([desk, shelf]));
    expect(JSON.parse(String(run?.detail))).toMatchObject({ model: "claude-opus-5-5" });
    expect(web.prompts).toHaveLength(1);
    expect(web.prompts[0]).toContain("Name: Shelf-bracket-v2-print");
    expect(web.prompts[0]).toContain("The app's matcher: Same name");
    expect(web.prompts[0]).toContain("Printer's estimate: 48 min");

    const offered = await suggestions(attemptId);
    expect(offered.map((one) => one.itemId)).toEqual([desk, shelf]);
    expect(offered[0]?.reasons[0]).toEqual({ kind: "claude", why: "Its last prints were lamp shades like this one" });
    // It placed nothing: the print is still in the printer's own build, asking.
    const still = await env.DB.prepare("SELECT asking, item_id FROM print_jobs WHERE attempt_id = ?")
      .bind(attemptId)
      .first();
    expect(still).toMatchObject({ asking: 1, item_id: attempt.itemId });

    // Asked once: a second run does nothing.
    await runPrintMatch(env, attemptId);
    expect(web.prompts).toHaveLength(1);
  });

  it("isn't asked when the matcher places the print", async () => {
    const web = stubClaude({ pick: "Desk light" });
    const desk = await build("Desk light");
    const fileId = uuid();
    const body = new FormData();
    body.set("name", "desk-lamp-arm.3mf");
    body.set("size", "4");
    body.set("plate", "1");
    body.set("plateCount", "1");
    body.set("prefill", JSON.stringify({ estimatedMinutes: 30, weightGrams: 1 }));
    body.set("thumb", new File([PNG], "plate_1.png", { type: "image/png" }));
    body.set("file", new File([new Uint8Array([0x50, 0x4b, 3, 4])], "desk-lamp-arm.3mf"));
    expect((await request(`/api/items/${desk}/files/${fileId}`, { method: "PUT", body, cookie })).status).toBe(201);
    await request(`/api/files/${fileId}/downloads`, { method: "POST", cookie });
    const { attempt } = await bridgePrints("desk-lamp-arm(2)");
    expect(attempt.itemId).toBe(desk);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(web.prompts).toHaveLength(0);
    expect(await runs()).toHaveLength(0);
  });

  it("leaves the matcher's suggestions when Claude names none, or the call fails", async () => {
    stubClaude({ pick: null });
    await build("Desk light");
    const shelf = await build("Shelf brackets");
    const first = await bridgePrints("Shelf-bracket-v2-print");
    expect(await settled()).toMatchObject({ status: "none", item_id: null });
    expect((await suggestions(first.attemptId)).map((one) => one.itemId)).toEqual([shelf]);

    vi.restoreAllMocks();
    await resetDb();
    await addUser("sam", "correct horse", "Sam Lind", "sea");
    cookie = await signIn("sam", "correct horse");
    const made = await request("/api/agents", {
      method: "POST",
      json: { name: "Printer bridge", scopes: ["read", "attempts", "printer"] },
      cookie,
    });
    token = (await made.json<NewTokenResponse>()).token;
    await asBridge("/api/printer/bridge", { method: "PUT", json: { printerState: "idle", progress: null } });
    stubClaude({ status: 500 });
    await build("Desk light");
    const shelfAgain = await build("Shelf brackets");
    const second = await bridgePrints("Shelf-bracket-v2-print");
    expect(await settled()).toMatchObject({ status: "failed", run_outcome: "api_error" });
    const offered = await suggestions(second.attemptId);
    expect(offered.map((one) => one.itemId)).toEqual([shelfAgain]);
    expect(offered[0]?.reasons[0]?.kind).not.toBe("claude");
  });

  it("isn't asked without a key", async () => {
    const web = stubClaude({ pick: "Desk light" });
    await build("Desk light");
    const bare = { ...env, ANTHROPIC_API_KEY: undefined } as unknown as Env;
    // The filing asked once; without the key the same run asks nothing and records nothing.
    const { attemptId } = await bridgePrints("mystery-part");
    await settled();
    await env.DB.prepare("DELETE FROM print_match_runs").run();
    web.prompts.length = 0;
    await runPrintMatch(bare, attemptId);
    expect(web.prompts).toHaveLength(0);
    expect(await runs()).toHaveLength(0);
  });

  it("isn't asked about a print with no name or mark: the question would offer nothing", async () => {
    const web = stubClaude({ pick: "Desk light" });
    await build("Desk light");
    const { attemptId } = await bridgePrints("named-for-now");
    await settled();
    await env.DB.prepare("DELETE FROM print_match_runs").run();
    await env.DB.prepare("UPDATE print_jobs SET name = NULL WHERE attempt_id = ?").bind(attemptId).run();
    web.prompts.length = 0;
    await runPrintMatch(env, attemptId);
    expect(web.prompts).toHaveLength(0);
    expect(await runs()).toHaveLength(0);
  });

  it("stops at the day's cap, and says so in the run", async () => {
    const web = stubClaude({ pick: "Desk light", reason: "fits" });
    await build("Desk light");
    const now = Date.now();
    const filler = await bridgePrints("cap-filler");
    await settled();
    // The rest of the day's runs, made up (each needs an attempt of its own).
    const statements = [];
    for (let i = 1; i < PRINT_MATCHES_PER_DAY; i++) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO attempts (id, item_id, printed_at, note, failure_tags, success_notes, settings, parts, created_by, created_at, updated_at)
           SELECT ?, item_id, ?, '', '[]', '[]', '{}', '[]', created_by, ?, ? FROM attempts WHERE id = ?`,
        ).bind(`cap-${i}`, now, now, now, filler.attemptId),
        env.DB.prepare(
          "INSERT INTO print_match_runs (attempt_id, status, created_at, ran_at) VALUES (?, 'picked', ?, ?)",
        ).bind(`cap-${i}`, now, now),
      );
    }
    await env.DB.batch(statements);
    const before = web.prompts.length;
    const { attemptId } = await bridgePrints("one-too-many");
    await vi.waitFor(
      async () => {
        const row = await env.DB.prepare("SELECT status, ran_at FROM print_match_runs WHERE attempt_id = ?")
          .bind(attemptId)
          .first();
        expect(row).toMatchObject({ status: "cap", ran_at: null });
      },
      { timeout: 5000 },
    );
    expect(web.prompts).toHaveLength(before);
  });
});
