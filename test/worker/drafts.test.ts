import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NewTokenResponse } from "../../src/shared/agents.ts";
import type { DraftResponse, FeaturesResponse, ItemResponse } from "../../src/shared/api.ts";
import { DRAFTS_PER_DAY } from "../../src/shared/draft.ts";
import { app } from "../../src/worker/app.ts";
import { resumeDrafts, STALE_MS } from "../../src/worker/draft/run.ts";
import makerworldPage from "../fixtures/pages/makerworld.html?raw";
import golfPage from "../fixtures/pages/makerworld-golf.html?raw";
import printablesChallenge from "../fixtures/pages/printables-challenge.html?raw";
import { addUser, ORIGIN, request, resetDb, signIn } from "./helpers.ts";

const PAGE = "https://makerworld.com/en/models/12345-cable-comb";
const IMAGE = "https://public-cdn.bblmw.com/cover.jpg";

/** A JPEG start with a frame header saying 1600 × 1200: all readImage needs. */
const jpeg = () =>
  new Uint8Array([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x04, 0xb0, 0x06, 0x40, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1,
  ]);

/** A WebP header (VP8X) saying 1600 × 1200. */
const webp = () =>
  new Uint8Array([
    ...[0x52, 0x49, 0x46, 0x46, 0x1a, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58, 10, 0, 0, 0],
    ...[0, 0, 0, 0, 0x3f, 0x06, 0, 0xaf, 0x04, 0],
  ]);
/** The start of a PNG. */
const png = () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);

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
type Page = { status?: number; body?: string; location?: string };

/** Stubs the Anthropic API and the image host; Responses are made inside the stub (a Response can't cross requests). */
function stubWeb(
  answer: Answer | (() => Answer) = { json: goodDraft },
  pages: Record<string, Page> = {},
  pngOnly = false,
) {
  const asked: string[] = [];
  const bodies: Array<Record<string, unknown>> = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    asked.push(url.href);
    if (url.hostname === "cloudflare-dns.com") {
      const type = url.searchParams.get("type");
      return Response.json({ Status: 0, Answer: type === "A" ? [{ type: 1, data: "93.184.216.34" }] : [] });
    }
    const page = pages[url.href];
    if (page) {
      return new Response(page.body ?? "", {
        status: page.status ?? 200,
        headers: { "Content-Type": "text/html", ...(page.location ? { Location: page.location } : {}) },
      });
    }
    if (url.hostname === "makerworld.bblmw.com") {
      // MakerWorld's pictures are PNGs; its image host converts to WebP when asked (x-oss-process).
      return url.search.includes("x-oss-process") && !pngOnly
        ? new Response(webp(), { headers: { "Content-Type": "image/webp" } })
        : new Response(png(), { headers: { "Content-Type": "image/png" } });
    }
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

beforeEach(async () => {
  await resetDb();
  await addUser("alex", "correct horse", "Alex Rivera", "tomato");
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
    expect(JSON.parse(run?.detail ?? "{}")).toMatchObject({
      stopReason: "end_turn",
      source: "web_fetch",
      pageStatus: 404,
    });

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

    // Asking again brings the pictures back (same ids, so the deleted rows are revived).
    const again = await (await draftIt(id)).json<DraftResponse>();
    expect(again.draft?.applied).toContain("photos");
    expect((await getItem(id)).photos).toHaveLength(1);
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

  it("reads the page in the Worker and has Claude write only the note: the page's facts stay the page's", async () => {
    const web = stubWeb(
      {
        json: {
          readable: true,
          note: "A flexi red panda that wiggles. Fun to print and give away.",
          material: "PLA",
          plate: "Textured PEI plate",
          settings: "0.2 mm layers",
        },
      },
      { [PAGE]: { body: makerworldPage } },
    );
    const id = await addIdea({ note: PAGE });
    const { draft } = await (await draftIt(id)).json<DraftResponse>();
    expect(draft).toMatchObject({
      status: "drafted",
      applied: ["title", "note", "photos"],
      findings: { designer: "Fluffy Tails", license: "Standard Digital File License", material: "PLA" },
    });
    const item = await getItem(id);
    expect(item.title).toBe("Fluffy Tail Cute Flexi Red Panda - Toy / Keychain");
    expect(item.note).toContain("A flexi red panda that wiggles.");
    expect(item.photos.length).toBeGreaterThan(0);
    // No web fetch tool: Claude gets the page's text and print profiles as data.
    const sent = web.bodies[0] as { tools?: unknown[]; messages: Array<{ content: string }> };
    expect(sent.tools ?? []).toEqual([]);
    expect(sent.messages[0]?.content).toContain("needs an AMS");
    expect(sent.messages[0]?.content).not.toContain("<boostme>");
    // Only the allowed picture host was downloaded, and the run says where the page came from.
    expect(web.asked.filter((url) => !/cloudflare-dns|anthropic|makerworld\.com|bblmw/.test(url))).toEqual([]);
    const run = await env.DB.prepare("SELECT outcome, detail FROM draft_runs").first<{
      outcome: string;
      detail: string;
    }>();
    expect(JSON.parse(run?.detail ?? "{}")).toMatchObject({ source: "worker_fetch", pageStatus: 200 });
  });

  it("falls back to Claude's web fetch when the page turns the Worker away, and says so", async () => {
    const web = stubWeb(undefined, { [PAGE]: { status: 403, body: printablesChallenge } });
    const id = await addIdea({ note: PAGE });
    const { draft } = await (await draftIt(id)).json<DraftResponse>();
    expect(draft?.status).toBe("drafted");
    expect((web.bodies[0] as { tools: unknown[] }).tools).toHaveLength(1);
    const run = await env.DB.prepare("SELECT detail FROM draft_runs").first<{ detail: string }>();
    expect(JSON.parse(run?.detail ?? "{}")).toMatchObject({ source: "web_fetch", pageStatus: 403 });
  });

  it("falls back too when the page has nothing to draft from, and never follows a redirect off the three sites", async () => {
    const empty = stubWeb(undefined, { [PAGE]: { body: "<html><body>Just a moment</body></html>" } });
    const id = await addIdea({ note: PAGE });
    await draftIt(id);
    const detail = await env.DB.prepare("SELECT detail FROM draft_runs").first<{ detail: string }>();
    expect(JSON.parse(detail?.detail ?? "{}")).toMatchObject({
      source: "web_fetch",
      pageStatus: 200,
      pageUnreadable: true,
    });
    expect(empty.bodies).toHaveLength(1);

    vi.restoreAllMocks();
    await resetDb();
    await addUser("alex", "correct horse", "Alex Rivera", "tomato");
    cookie = await signIn("alex", "correct horse");
    const away = stubWeb(undefined, { [PAGE]: { status: 302, location: "https://evil.example/model" } });
    const other = await addIdea({ note: PAGE });
    await draftIt(other);
    expect(away.asked.some((url) => url.includes("evil.example"))).toBe(false);
  });

  it("stores MakerWorld's PNG pictures as WebP through its image host, and says what happened to them", async () => {
    stubWeb(
      { json: { readable: true, note: "A mini golf set.", material: null, plate: null, settings: null } },
      { [PAGE]: { body: golfPage } },
    );
    const id = await addIdea({ note: PAGE });
    const { draft } = await (await draftIt(id)).json<DraftResponse>();
    expect(draft?.applied).toContain("photos");
    const item = await getItem(id);
    expect(item.photos).toHaveLength(4);
    const run = await env.DB.prepare("SELECT detail FROM draft_runs").first<{ detail: string }>();
    expect(JSON.parse(run?.detail ?? "{}").pictures).toMatchObject({ found: 7, stored: 4, refused: [] });
  });

  it("records why no picture was stored, and 'Get the pictures' tries again without using the day's cap", async () => {
    stubWeb(
      { json: { readable: true, note: "A mini golf set.", material: null, plate: null, settings: null } },
      { [PAGE]: { body: golfPage } },
      true,
    );
    const id = await addIdea({ note: PAGE });
    await draftIt(id);
    expect((await getItem(id)).photos).toHaveLength(0);
    const run = await env.DB.prepare("SELECT detail FROM draft_runs").first<{ detail: string }>();
    const pictures = JSON.parse(run?.detail ?? "{}").pictures;
    expect(pictures).toMatchObject({ found: 7, stored: 0 });
    expect(pictures.refused[0]).toMatch(/^makerworld\.bblmw\.com: not a JPEG or WebP \(12 bytes\)/);

    vi.restoreAllMocks();
    stubWeb();
    const got = await asPerson(`/api/items/${id}/draft/pictures`, { method: "POST" });
    expect((await got.json<DraftResponse>()).stored).toBe(4);
    const item = await getItem(id);
    expect(item.photos).toHaveLength(4);
    expect(item.draft?.applied).toContain("photos");
    // Nothing to do when it has pictures; and a people-only action.
    expect((await asPerson(`/api/items/${id}/draft/pictures`, { method: "POST" })).status).toBe(404);
    const used = await env.DB.prepare("SELECT count(*) AS n FROM draft_runs WHERE outcome IS NOT 'pictures'").first<{
      n: number;
    }>();
    expect(used?.n).toBe(1);
    // Undo takes the fetched pictures off again.
    await asPerson(`/api/items/${id}/draft`, { method: "DELETE" });
    expect((await getItem(id)).photos).toHaveLength(0);
  });

  it("a title that came with a shared link doesn't stop the draft, and the draft's replaces it (the Shortcut, the bookmarklet)", async () => {
    stubWeb();
    const sharing = await (
      await asPerson("/api/agents", { method: "POST", json: { name: "Share from iPhone", scopes: ["capture"] } })
    ).json<NewTokenResponse>();
    const viaShortcut = await request("/api/capture", {
      method: "POST",
      json: { url: PAGE, title: "Cable comb by Mila | MakerWorld" },
      headers: { Authorization: `Bearer ${sharing.token}` },
    });
    const { id } = await viaShortcut.json<{ id: string }>();
    expect((await getItem(id)).title).toBe("Cable comb by Mila | MakerWorld");
    await draftIt(id);
    const item = await getItem(id);
    expect(item.draft).toMatchObject({ status: "drafted", applied: expect.arrayContaining(["title", "note"]) });
    expect(item.title).toBe("Cable comb");
    // Undo gives the shared title back.
    await asPerson(`/api/items/${id}/draft`, { method: "DELETE" });
    expect((await getItem(id)).title).toBe("Cable comb by Mila | MakerWorld");

    // The same from a signed-in person's capture (a script, the bookmarklet's server path).
    const viaSession = await asPerson("/api/capture", { method: "POST", json: { url: PAGE, title: "Shared title" } });
    const other = (await viaSession.json<{ id: string }>()).id;
    expect((await getItem(other)).draft).not.toBeNull();
    await draftIt(other);
    expect((await getItem(other)).title).toBe("Cable comb");
  });

  it("from the app's share route: the shared title is replaced, a title a person typed never is", async () => {
    stubWeb();
    // The share route saves the idea with the page's title and then asks, saying that title was shared.
    const shared = await addIdea({ title: "Page title from the share", note: PAGE });
    const { draft } = await (await draftIt(shared, { sharedTitle: "Page title from the share" })).json<DraftResponse>();
    expect(draft?.applied).toContain("title");
    expect((await getItem(shared)).title).toBe("Cable comb");

    // A person typed it: asking with no shared title (or after editing) leaves it alone.
    const typed = await addIdea({ title: "Mila's comb", note: PAGE });
    const typedDraft = await (await draftIt(typed, { sharedTitle: "Page title from the share" })).json<DraftResponse>();
    expect(typedDraft.draft?.applied).not.toContain("title");
    expect((await getItem(typed)).title).toBe("Mila's comb");

    // Edited after the draft was asked for: the person's edit wins.
    const edited = await addIdea({ title: "Page title from the share", note: PAGE });
    await asPerson("/api/items/" + edited, { method: "PATCH", json: { title: "My title" } });
    const editedDraft = await (
      await draftIt(edited, { sharedTitle: "Page title from the share" })
    ).json<DraftResponse>();
    expect(editedDraft.draft?.applied).not.toContain("title");
    expect((await getItem(edited)).title).toBe("My title");
  });

  it("an agent that can do more than share still can't start a draft, with a title or without", async () => {
    stubWeb();
    const agent = await (
      await asPerson("/api/agents", {
        method: "POST",
        json: { name: "Claude", scopes: ["read", "capture", "attempts"] },
      })
    ).json<NewTokenResponse>();
    const response = await request("/api/capture", {
      method: "POST",
      json: { url: PAGE, title: "A title" },
      headers: { Authorization: `Bearer ${agent.token}` },
    });
    expect((await getItem((await response.json<{ id: string }>()).id)).draft).toBeNull();
  });
});
