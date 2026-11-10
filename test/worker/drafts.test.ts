import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NewTokenResponse } from "../../src/shared/agents.ts";
import type { DraftResponse, FeaturesResponse, ItemResponse } from "../../src/shared/api.ts";
import { DRAFTS_PER_DAY } from "../../src/shared/draft.ts";
import { app } from "../../src/worker/app.ts";
import { resumeDrafts, STALE_MS } from "../../src/worker/draft/run.ts";
import { addUser, ORIGIN, request, resetDb, signIn } from "./helpers.ts";

const PAGE = "https://makerworld.com/en/models/12345-cable-comb";
const IMAGE = "https://public-cdn.bblmw.com/cover.jpg";

/** A JPEG start with a frame header saying 1600 × 1200: all readImage needs. */
const jpeg = () =>
  new Uint8Array([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x04, 0xb0, 0x06, 0x40, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1,
  ]);

const goodDraft = {
  readable: true,
  title: "Cable comb",
  note: "A tiny comb that keeps the desk cables in line. Quick to print and useful at once.",
  designer: "Mila",
  license: "CC BY 4.0",
  material: "PETG",
  plate: "Textured PEI plate",
  settings: "0.2 mm layers, 15% infill",
  imageUrls: [IMAGE, "https://evil.example/tracker.jpg"],
};

type Answer = { json?: unknown; stopReason?: string; status?: number };

/** Stubs the Anthropic API and the image host; Responses are made inside the stub (a Response can't cross requests). */
function stubWeb(answer: Answer | (() => Answer) = { json: goodDraft }) {
  const asked: string[] = [];
  const bodies: Array<Record<string, unknown>> = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    asked.push(url.href);
    if (url.hostname === "api.anthropic.com") {
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
    }
    if (url.href === IMAGE) return new Response(jpeg(), { headers: { "Content-Type": "image/jpeg" } });
    return new Response("nope", { status: 404 });
  });
  return { asked, bodies };
}

let cookie: string;
let alex: string;

beforeEach(async () => {
  await resetDb();
  alex = await addUser("alex", "correct horse", "Alex Rivera", "tomato");
  cookie = await signIn("alex", "correct horse");
});
afterEach(() => vi.restoreAllMocks());

const asPerson = (path: string, init: Parameters<typeof request>[1] = {}) => request(path, { cookie, ...init });
async function addIdea(fields: { title?: string | null; note?: string } = {}) {
  const id = crypto.randomUUID();
  await asPerson("/api/items", { method: "POST", json: { id, ...fields } });
  return id;
}
const getItem = async (id: string) => (await (await asPerson(`/api/items/${id}`)).json<ItemResponse>()).item;
const draftIt = (id: string, json?: unknown) =>
  asPerson(`/api/items/${id}/draft`, { method: "POST", json: json ?? {} });

describe("drafting an idea from a model page", () => {
  it("is hidden without the key", async () => {
    expect((await (await asPerson("/api/features")).json<FeaturesResponse>()).drafts).toBe(true);
    const bare = { ...env, ANTHROPIC_API_KEY: undefined } as unknown as Env;
    const id = await addIdea({ note: PAGE });
    const features = await app.fetch(new Request(`${ORIGIN}/api/features`, { headers: { Cookie: cookie } }), bare);
    expect((await features.json<FeaturesResponse>()).drafts).toBe(false);
    const ask = await app.fetch(
      new Request(`${ORIGIN}/api/items/${id}/draft`, { method: "POST", headers: { Cookie: cookie, Origin: ORIGIN } }),
      bare,
    );
    expect(ask.status).toBe(404);
    expect((await getItem(id)).draft).toBeNull();
  });

  it("fills an empty idea: title, note, the allowed pictures, and what the page says", async () => {
    const web = stubWeb();
    const id = await addIdea({ note: PAGE });
    const response = await draftIt(id);
    expect(response.status).toBe(200);
    const { draft } = await response.json<DraftResponse>();
    expect(draft).toMatchObject({
      status: "drafted",
      site: "makerworld",
      applied: ["title", "note", "photos"],
      findings: { designer: "Mila", license: "CC BY 4.0", material: "PETG", plate: "Textured PEI plate" },
    });

    const item = await getItem(id);
    expect(item.title).toBe("Cable comb");
    expect(item.note).toBe(`${goodDraft.note}\n\n${PAGE}`);
    expect(item.photos).toHaveLength(1);
    // Stored for a browser to resize, and nothing off the allowlist was downloaded.
    expect(web.asked).toContain(IMAGE);
    expect(web.asked.some((url) => url.includes("evil.example"))).toBe(false);
    const row = await env.DB.prepare("SELECT needs_resize FROM photos WHERE item_id = ?")
      .bind(id)
      .first<{ needs_resize: number }>();
    expect(row?.needs_resize).toBe(1);

    // The note's link card gets the page's title too.
    const preview = await env.DB.prepare("SELECT title, site FROM link_previews WHERE url = ?")
      .bind(PAGE)
      .first<{ title: string; site: string }>();
    expect(preview).toEqual({ title: "Cable comb", site: "MakerWorld" });
    // The run says how it went, without the page's words.
    const run = await env.DB.prepare("SELECT outcome, detail FROM draft_runs").first<{
      outcome: string;
      detail: string;
    }>();
    expect(run?.outcome).toBe("drafted");
    expect(JSON.parse(run?.detail ?? "{}")).toEqual({ stopReason: "end_turn" });

    // Opus, the web fetch tool limited to the three sites, and a JSON schema for the answer.
    const sent = web.bodies[0] as {
      model: string;
      tools: Array<{ type: string; allowed_domains: string[] }>;
      output_config: { format: { type: string } };
    };
    expect(sent.model).toBe("claude-opus-5-5");
    expect(sent.tools[0]?.type).toBe("web_fetch_20260209");
    expect(sent.tools[0]?.allowed_domains).toEqual(["makerworld.com", "printables.com", "thingiverse.com"]);
    expect(sent.output_config.format.type).toBe("json_schema");
  });

  it("never overwrites what a person wrote", async () => {
    stubWeb();
    const note = `My own words about it ${PAGE}`;
    const id = await addIdea({ title: "Comb for Mila", note });
    const { draft } = await (await draftIt(id)).json<DraftResponse>();
    expect(draft?.status).toBe("drafted");
    expect(draft?.applied).toEqual(["photos"]);
    const item = await getItem(id);
    expect(item.title).toBe("Comb for Mila");
    expect(item.note).toBe(note);
  });

  it("fills only the empty one when the person wrote one of them", async () => {
    stubWeb();
    const id = await addIdea({ title: "Comb for Mila", note: PAGE });
    const { draft } = await (await draftIt(id)).json<DraftResponse>();
    expect(draft?.applied).toEqual(["note", "photos"]);
    expect((await getItem(id)).title).toBe("Comb for Mila");
  });

  it("undo takes back what it wrote and leaves later edits alone", async () => {
    stubWeb();
    const id = await addIdea({ note: PAGE });
    await draftIt(id);
    await asPerson(`/api/items/${id}`, { method: "PATCH", json: { title: "Cable comb, my way" } });
    const undone = await asPerson(`/api/items/${id}/draft`, { method: "DELETE" });
    expect(undone.status).toBe(200);
    const item = await getItem(id);
    expect(item.draft).toBeNull();
    expect(item.title).toBe("Cable comb, my way");
    expect(item.note).toBe(PAGE);
    expect(item.photos).toHaveLength(0);
  });

  it("leaves the idea as captured, with a reason, when Claude refuses or can't read the page", async () => {
    const id = await addIdea({ note: PAGE });
    stubWeb({ stopReason: "refusal" });
    expect((await (await draftIt(id)).json<DraftResponse>()).draft).toMatchObject({
      status: "failed",
      failure: "refused",
    });
    stubWeb({ json: { ...goodDraft, readable: false } });
    vi.restoreAllMocks();
    stubWeb({ json: { ...goodDraft, readable: false } });
    // Retrying is asking again.
    expect((await (await draftIt(id)).json<DraftResponse>()).draft).toMatchObject({
      status: "failed",
      failure: "unreadable",
    });
    const item = await getItem(id);
    expect(item.title).toBeNull();
    expect(item.note).toBe(PAGE);

    vi.restoreAllMocks();
    stubWeb({ status: 529 });
    expect((await (await draftIt(id)).json<DraftResponse>()).draft?.failure).toBe("unreadable");
    const { results } = await env.DB.prepare("SELECT outcome, detail FROM draft_runs ORDER BY at, rowid").all<{
      outcome: string;
      detail: string | null;
    }>();
    expect(results.map((run) => run.outcome)).toEqual(["refusal", "not_readable", "api_error"]);
    expect(JSON.parse(results[2]?.detail ?? "{}")).toMatchObject({ httpStatus: 529, errorType: "api_error" });
    expect(results[2]?.detail).not.toContain("sk-ant");

    // A retry that works clears the failure.
    vi.restoreAllMocks();
    stubWeb();
    expect((await (await draftIt(id)).json<DraftResponse>()).draft).toMatchObject({ status: "drafted", failure: null });
  });

  it("stops at the day's cap without calling Claude", async () => {
    const web = stubWeb();
    for (let i = 0; i < DRAFTS_PER_DAY; i++) {
      await env.DB.prepare("INSERT INTO draft_runs (id, item_id, at) VALUES (?, ?, ?)")
        .bind(`r${i}`, "x", Date.now())
        .run();
    }
    const id = await addIdea({ note: PAGE });
    expect((await (await draftIt(id)).json<DraftResponse>()).draft).toMatchObject({ status: "failed", failure: "cap" });
    expect(web.bodies).toHaveLength(0);
  });

  it("refuses links that aren't on the three model sites, and never lets an agent token ask", async () => {
    const web = stubWeb();
    const id = await addIdea({ note: "https://example.com/model" });
    expect((await draftIt(id)).status).toBe(400);
    expect((await draftIt(id, { url: "https://example.com/model" })).status).toBe(400);
    expect(web.asked).toEqual([]);

    const made = await asPerson("/api/agents", {
      method: "POST",
      json: { name: "Claude", scopes: ["read", "capture", "attempts"] },
    });
    const { token } = await made.json<NewTokenResponse>();
    const modelId = await addIdea({ note: PAGE });
    const asked = await request(`/api/items/${modelId}/draft`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(asked.status).toBe(403);
    expect(web.asked).toEqual([]);
  });

  it("starts on its own from a capture that is only a model link: a person's, or a sharing token's, not an agent's", async () => {
    stubWeb();
    const shared = await asPerson("/api/capture", { method: "POST", json: { url: PAGE } });
    const { id } = await shared.json<{ id: string }>();
    expect((await getItem(id)).draft?.status).toMatch(/reading|drafted/);

    const sharing = await (
      await asPerson("/api/agents", { method: "POST", json: { name: "Share from iPhone", scopes: ["capture"] } })
    ).json<NewTokenResponse>();
    const viaShortcut = await request("/api/capture", {
      method: "POST",
      json: { url: "https://www.printables.com/model/99-hook" },
      headers: { Authorization: `Bearer ${sharing.token}` },
    });
    expect((await getItem((await viaShortcut.json<{ id: string }>()).id)).draft).not.toBeNull();

    const mcp = await (
      await asPerson("/api/agents", {
        method: "POST",
        json: { name: "Claude", scopes: ["read", "capture", "attempts"] },
      })
    ).json<NewTokenResponse>();
    const viaAgent = await request("/api/capture", {
      method: "POST",
      json: { url: "https://www.thingiverse.com/thing:5" },
      headers: { Authorization: `Bearer ${mcp.token}` },
    });
    expect((await getItem((await viaAgent.json<{ id: string }>()).id)).draft).toBeNull();

    // Words of the person's own mean it isn't a bare link: nothing is started.
    const wordy = await asPerson("/api/capture", {
      method: "POST",
      json: { text: "For the shelf, see if it fits. ".repeat(5), url: PAGE },
    });
    expect((await getItem((await wordy.json<{ id: string }>()).id)).draft).toBeNull();
  });

  it("the cron picks up a draft whose worker was lost, and gives up on one that keeps being lost", async () => {
    const web = stubWeb();
    const id = await addIdea({ note: PAGE });
    await env.DB.prepare(
      "INSERT INTO item_drafts (item_id, url, site, status, claimed_at, tries, applied, created_at) VALUES (?, ?, 'makerworld', 'reading', ?, 1, '[]', ?)",
    )
      .bind(id, PAGE, Date.now() - STALE_MS - 1000, Date.now())
      .run();
    expect(await resumeDrafts(env)).toBe(1);
    expect(web.bodies).toHaveLength(1);
    expect((await getItem(id)).draft?.status).toBe("drafted");

    const lost = await addIdea({ note: PAGE });
    await env.DB.prepare(
      "INSERT INTO item_drafts (item_id, url, site, status, claimed_at, tries, applied, created_at) VALUES (?, ?, 'makerworld', 'reading', ?, 2, '[]', ?)",
    )
      .bind(lost, PAGE, Date.now() - STALE_MS - 1000, Date.now())
      .run();
    await resumeDrafts(env);
    expect((await getItem(lost)).draft).toMatchObject({ status: "failed", failure: "timeout" });
    expect(web.bodies).toHaveLength(1);
  });
});
