import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NewTokenResponse } from "../../src/shared/agents.ts";
import type { FeaturesResponse, ItemResponse } from "../../src/shared/api.ts";
import { SCOUT_COUNT, type ScoutPick, type ScoutResponse, scoutKeysIn, scoutLink } from "../../src/shared/scout.ts";
import { mondayOf } from "../../src/shared/week.ts";
import { app } from "../../src/worker/app.ts";
import { runScout, SCOUT_RUNS_PER_DAY, scoutTick } from "../../src/worker/scout/run.ts";
import { addUser, ORIGIN, request, resetDb, signIn } from "./helpers.ts";

const at = (iso: string) => Date.parse(iso);
/** A Wednesday morning in Stockholm, in the week of Monday 12 January 2026. */
const wed = at("2026-01-14T09:00:00+01:00");
const MONDAY = "2026-01-12";

const uuid = () => crypto.randomUUID();

/** A JPEG start with a frame header saying 1600 × 1200: all readImage needs. */
const jpeg = () =>
  new Uint8Array([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x04, 0xb0, 0x06, 0x40, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1,
  ]);

const MODELS = {
  drawer: { url: "https://makerworld.com/en/models/1100001-drawer-divider-set", title: "Drawer divider set" },
  planter: { url: "https://www.thingiverse.com/thing:6100002", title: "Planter with a saucer" },
  clips: { url: "https://makerworld.com/en/models/1100003-cable-chain-clips", title: "Cable chain clips" },
  vase: { url: "https://makerworld.com/en/models/1100004-spiral-vase", title: "Spiral vase" },
} as const;

const suggestion = (model: { url: string; title: string }, why = "For the kitchen drawer you saved.") => ({
  ...model,
  why,
  imageUrl: null as string | null,
});

type Answer = { json?: unknown; stopReason?: string; status?: number; blocks?: unknown[] };

const pageFor = (title: string, image: string) =>
  `<html><head><meta property="og:title" content="${title}"><meta property="og:image" content="${image}"></head><body>${title}</body></html>`;
/** What Thingiverse answers for a thing that isn't there: 200, and the site's own name as the title. */
const THINGIVERSE_MISSING = pageFor(
  "Thingiverse - The community for Open Hardware",
  "https://cdn.thingiverse.com/og.webp",
);
/** What MakerWorld's page answers for a model number that isn't there: 200, and a design with no title. */
const MAKERWORLD_MISSING = `<html><head><meta property="og:description" content="MakerWorld is the leading 3D printing model community"></head><body><script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"design":{"status":-1}}}}</script></body></html>`;
const CHALLENGE = () =>
  new Response("<html><head><title>Just a moment...</title></head></html>", {
    status: 403,
    headers: { "Content-Type": "text/html", "cf-mitigated": "challenge" },
  });

/** A web fetch tool result block, as the API returns one for a page Claude read. */
const fetchedBlock = (url: string, title: string | null, text = "") => [
  { type: "server_tool_use", id: `srvtoolu_${url.length}`, name: "web_fetch", input: { url } },
  {
    type: "web_fetch_tool_result",
    tool_use_id: `srvtoolu_${url.length}`,
    content: {
      type: "web_fetch_result",
      url,
      retrieved_at: "2026-01-14T08:00:00Z",
      content: {
        type: "document",
        title,
        citations: null,
        source: { type: "text", media_type: "text/plain", data: text },
      },
    },
  },
];

/**
 * Stubs Anthropic, the two model sites (MakerWorld's pages and design API, Thingiverse's pages) and their image
 * hosts, as they really answer. A model not in MODELS isn't there: MakerWorld's API says 404 and its page has no
 * design; Thingiverse answers its soft "not found". `dead` lists models that are gone (404 everywhere);
 * `challenge` those MakerWorld's bot protection challenges, page and API; `pageChallenge` only the page;
 * `forbidden` those answered with a plain 403. Responses are made inside the stub.
 */
function stubWeb(
  answer: Answer | (() => Answer),
  options: { dead?: string[]; challenge?: string[]; pageChallenge?: string[]; forbidden?: string[] } = {},
) {
  const asked: string[] = [];
  const bodies: Array<Record<string, unknown>> = [];
  const listed = (list: string[] | undefined, model: { url: string } | undefined) =>
    !!model && !!list?.includes(model.url);
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    asked.push(url.href);
    if (url.hostname === "cloudflare-dns.com") {
      return Response.json({
        Status: 0,
        Answer: url.searchParams.get("type") === "A" ? [{ type: 1, data: "93.184.216.34" }] : [],
      });
    }
    if (url.hostname === "api.anthropic.com") {
      bodies.push(JSON.parse(String(init?.body)));
      const next = typeof answer === "function" ? answer() : answer;
      if (next.status) {
        return Response.json({ type: "error", error: { type: "api_error", message: "no" } }, { status: next.status });
      }
      return Response.json({
        id: "msg_test",
        type: "message",
        role: "assistant",
        model: "claude-opus-5-5",
        content:
          next.stopReason === "refusal"
            ? []
            : [...(next.blocks ?? []), { type: "text", text: JSON.stringify(next.json) }],
        stop_reason: next.stopReason ?? "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 10 },
      });
    }
    const api = /^\/api\/v1\/design-service\/design\/(\d+)$/.exec(url.pathname)?.[1];
    if (url.hostname === "makerworld.com" && api) {
      const model = Object.values(MODELS).find((m) => m.url.includes(`/models/${api}-`));
      if (listed(options.challenge, model)) return CHALLENGE();
      if (listed(options.forbidden, model)) return new Response("no", { status: 403 });
      if (!model || listed(options.dead, model)) {
        return Response.json({ code: 404, error: "The server cannot find the requested resource." }, { status: 404 });
      }
      return Response.json({
        id: Number(api),
        title: "抽屉分隔板",
        titleTranslated: model.title,
        coverUrl: "https://makerworld.bblmw.com/makerworld/model/cover.jpg",
      });
    }
    if (url.hostname === "makerworld.com" || url.hostname === "www.thingiverse.com") {
      const model = Object.values(MODELS).find((m) => url.pathname.includes(m.url.split("/").pop() ?? "?"));
      if (listed(options.dead, model)) return new Response("gone", { status: 404 });
      if (listed(options.challenge, model) || listed(options.pageChallenge, model)) return CHALLENGE();
      if (listed(options.forbidden, model)) return new Response("no", { status: 403 });
      const html = model
        ? pageFor(model.title, "https://cdn.thingiverse.com/pic.jpg")
        : url.hostname === "makerworld.com"
          ? MAKERWORLD_MISSING
          : THINGIVERSE_MISSING;
      return new Response(html, { headers: { "Content-Type": "text/html" } });
    }
    if (url.hostname === "cdn.thingiverse.com" || url.hostname === "makerworld.bblmw.com")
      return new Response(jpeg(), { headers: { "Content-Type": "image/jpeg" } });
    return new Response("nope", { status: 404 });
  });
  return { asked, bodies };
}

const detail = async () => JSON.parse((await rounds()).results[0]?.detail ?? "{}");

const good = {
  json: { suggestions: [suggestion(MODELS.drawer), suggestion(MODELS.planter), suggestion(MODELS.clips)] },
};

let cookie = "";
let alex = "";
let sam = "";

async function addIdea(fields: { title?: string | null; note?: string; by?: string } = {}) {
  const id = uuid();
  await env.DB.prepare(
    `INSERT INTO items (id, stage, title, note, created_by, created_at, updated_at) VALUES (?, 'idea', ?, ?, ?, ?, ?)`,
  )
    .bind(id, fields.title ?? "Kitchen drawer organizer", fields.note ?? "", fields.by ?? alex, wed - 1000, wed - 1000)
    .run();
  return id;
}

beforeEach(async () => {
  await resetDb();
  alex = await addUser("alex", "correct horse", "Alex Rivera", "tomato");
  sam = await addUser("sam", "another horse", "Sam", "sea");
  cookie = await signIn("alex", "correct horse");
  await addIdea();
});
afterEach(() => vi.restoreAllMocks());

const asPerson = (path: string, init: Parameters<typeof request>[1] = {}) => request(path, { cookie, ...init });
const scout = async () => (await (await asPerson("/api/scout")).json<ScoutResponse>()).scout;
const rounds = () =>
  env.DB.prepare("SELECT status, tries, run_outcome AS outcome, detail FROM scout_rounds").all<{
    status: string;
    tries: number;
    outcome: string | null;
    detail: string | null;
  }>();

describe("the idea scout's links", () => {
  it("knows a model by its number, whichever address it has, and only on the two sites that work", () => {
    expect(scoutLink("https://makerworld.com/en/models/1100001-drawer-divider-set?from=search")?.key).toBe(
      "makerworld:1100001",
    );
    expect(scoutLink("https://makerworld.com/models/1100001")?.key).toBe("makerworld:1100001");
    expect(scoutLink("https://www.thingiverse.com/thing:6100002/files")).toBeNull();
    expect(scoutLink("https://thingiverse.com/thing:6100002")?.url).toBe("https://www.thingiverse.com/thing:6100002");
    // Printables blocks Workers; searches and collections aren't a model.
    expect(scoutLink("https://www.printables.com/model/123-box")).toBeNull();
    expect(scoutLink("https://makerworld.com/en/search/models?keyword=box")).toBeNull();
    expect(scoutLink("http://makerworld.com/en/models/1100001")).toBeNull();
    expect(scoutKeysIn("See https://makerworld.com/en/models/1100001-x and https://example.com")).toEqual([
      "makerworld:1100001",
    ]);
  });
});

describe("the weekly scout", () => {
  it("is hidden without the key", async () => {
    expect((await (await asPerson("/api/features")).json<FeaturesResponse>()).scout).toBe(true);
    const bare = { ...env, ANTHROPIC_API_KEY: undefined } as unknown as Env;
    const features = await app.fetch(new Request(`${ORIGIN}/api/features`, { headers: { Cookie: cookie } }), bare);
    expect((await features.json<FeaturesResponse>()).scout).toBe(false);
    const ask = await app.fetch(new Request(`${ORIGIN}/api/scout`, { headers: { Cookie: cookie } }), bare);
    expect(ask.status).toBe(404);
    const web = stubWeb(good);
    expect(await scoutTick(bare, wed)).toBe("skipped");
    expect(web.asked).toEqual([]);
  });

  it("suggests three live models once a week, from what the two of you want", async () => {
    const wish = await addIdea({ title: "Planter for the balcony" });
    await env.DB.prepare("INSERT INTO wishlist_entries (user_id, item_id, position, added_at) VALUES (?, ?, 0, ?)")
      .bind(alex, wish, wed)
      .run();
    const web = stubWeb(good);
    expect(await scoutTick(env, wed)).toBe("done");

    const round = await scout();
    expect(round).toMatchObject({ monday: mondayOf(Date.now()), state: expect.any(String) });
    // The page is for "now": ask for the week the picks were made in.
    const rows = await env.DB.prepare("SELECT * FROM scout_picks ORDER BY position").all<Record<string, unknown>>();
    expect(rows.results).toHaveLength(SCOUT_COUNT);
    expect(rows.results.map((row) => row.monday)).toEqual([MONDAY, MONDAY, MONDAY]);
    expect(rows.results.map((row) => row.title)).toEqual([
      MODELS.drawer.title,
      MODELS.planter.title,
      MODELS.clips.title,
    ]);
    expect(rows.results.map((row) => row.key)).toEqual([
      "makerworld:1100001",
      "thingiverse:6100002",
      "makerworld:1100003",
    ]);
    // Each has the picture from the site's image host, stored.
    expect(rows.results.every((row) => row.picture_type === "image/jpeg")).toBe(true);
    expect(await env.PHOTOS.get(`scout/${rows.results[0]?.id}`)).not.toBeNull();

    // One call to Claude: Opus, search and fetch limited to the two sites (Printables is not among them), a JSON schema.
    const claude = web.bodies.filter((body) => body.model);
    expect(claude).toHaveLength(1);
    const sent = claude[0] as {
      model: string;
      tools: Array<{ type: string; allowed_domains: string[] }>;
      messages: Array<{ content: string }>;
    };
    expect(sent.model).toBe("claude-opus-5-5");
    expect(sent.tools.map((tool) => tool.type)).toEqual(["web_search_20260209", "web_fetch_20260209"]);
    for (const tool of sent.tools) expect(tool.allowed_domains).toEqual(["makerworld.com", "thingiverse.com"]);
    expect(sent.messages[0]?.content).toContain("Planter for the balcony");
    expect(sent.messages[0]?.content).toContain("Alex Rivera's wishlist");

    // Once a week: the next tick of the cron, and the same Wednesday evening, spend nothing.
    expect(await scoutTick(env, wed + 60_000)).toBe("skipped");
    expect(await scoutTick(env, wed + 8 * 3600_000)).toBe("skipped");
    expect(web.bodies.filter((body) => body.model)).toHaveLength(1);
    // The next Monday is a new week, and a new run.
    expect((await rounds()).results).toHaveLength(1);
  });

  it("waits for the morning and for the key", async () => {
    const web = stubWeb(good);
    expect(await scoutTick(env, at("2026-01-14T03:00:00+01:00"))).toBe("skipped");
    expect(web.asked).toEqual([]);
    expect(await scoutTick(env, at("2026-01-14T07:05:00+01:00"))).toBe("done");
  });

  it("has nothing to go on in an empty notebook, and guesses nothing", async () => {
    await resetDb();
    await addUser("alex", "correct horse", "Alex Rivera", "tomato");
    const web = stubWeb(good);
    expect(await scoutTick(env, wed)).toBe("nothing");
    expect(web.asked).toEqual([]);
    // No round is kept for the week: the first idea can still be scouted.
    expect((await rounds()).results).toHaveLength(0);
  });

  it("drops a link that is dead, challenged or not a model page, and keeps the rest", async () => {
    stubWeb(
      {
        json: {
          suggestions: [
            suggestion(MODELS.drawer),
            suggestion(MODELS.planter),
            suggestion({ url: "https://www.printables.com/model/9-box", title: "Box" }),
            suggestion({ url: "https://makerworld.com/en/search/models?keyword=x", title: "Search" }),
            suggestion(MODELS.clips),
            suggestion(MODELS.vase),
          ],
        },
      },
      { dead: [MODELS.planter.url], challenge: [MODELS.clips.url] },
    );
    expect(await scoutTick(env, wed)).toBe("done");
    const rows = await env.DB.prepare("SELECT title FROM scout_picks ORDER BY position").all<{ title: string }>();
    expect(rows.results.map((row) => row.title)).toEqual([MODELS.drawer.title, MODELS.vase.title]);
    expect(await detail()).toMatchObject({
      malformed: 2,
      dead: 2,
      deadBy: { not_found: 1, challenge: 1 },
      aliveBy: { api: 2 },
      kept: 2,
      dropped: [
        { url: MODELS.planter.url, by: "not_found", inSearch: false },
        { url: MODELS.clips.url, by: "challenge", inSearch: false },
      ],
    });
  });

  it("shows nothing when every link is dead, and says why", async () => {
    stubWeb(good, { dead: [MODELS.drawer.url, MODELS.planter.url, MODELS.clips.url] });
    expect(await scoutTick(env, wed)).toBe("nothing");
    expect((await rounds()).results[0]).toMatchObject({ status: "nothing", outcome: "all_dead" });
    expect((await scout()).picks).toEqual([]);
  });

  it("reads MakerWorld's design API when the page is behind a bot challenge, as it is for a Worker in production", async () => {
    stubWeb(good, { pageChallenge: [MODELS.drawer.url, MODELS.clips.url] });
    expect(await scoutTick(env, wed)).toBe("done");
    const rows = await env.DB.prepare("SELECT title, picture_type FROM scout_picks ORDER BY position").all<{
      title: string;
      picture_type: string | null;
    }>();
    // The English title, not the designer's own, and the cover from MakerWorld's image host.
    expect(rows.results).toEqual([
      { title: MODELS.drawer.title, picture_type: "image/jpeg" },
      { title: MODELS.planter.title, picture_type: "image/jpeg" },
      { title: MODELS.clips.title, picture_type: "image/jpeg" },
    ]);
    expect(await detail()).toMatchObject({ dead: 0, aliveBy: { api: 2, page: 1 }, kept: 3 });
  });

  it("drops a made-up link: MakerWorld's number that isn't there, and Thingiverse's soft 'not found'", async () => {
    const web = stubWeb({
      json: {
        suggestions: [
          suggestion({ url: "https://makerworld.com/en/models/9999991-plausible-hook", title: "Plausible hook" }),
          suggestion({ url: "https://www.thingiverse.com/thing:9999992", title: "Plausible clip" }),
          suggestion(MODELS.vase),
        ],
      },
      blocks: [
        { type: "server_tool_use", id: "srvtoolu_s", name: "web_search", input: { query: "spiral vase" } },
        {
          type: "web_search_tool_result",
          tool_use_id: "srvtoolu_s",
          content: [
            {
              type: "web_search_result",
              url: "https://www.thingiverse.com/thing:9999992",
              title: "x",
              encrypted_content: "e",
              page_age: null,
            },
          ],
        },
      ],
    });
    expect(await scoutTick(env, wed)).toBe("done");
    const rows = await env.DB.prepare("SELECT title FROM scout_picks").all<{ title: string }>();
    expect(rows.results.map((row) => row.title)).toEqual([MODELS.vase.title]);
    expect(await detail()).toMatchObject({
      searches: 1,
      fetches: 0,
      dead: 2,
      deadBy: { not_found: 1, no_model: 1 },
      dropped: [
        { url: "https://makerworld.com/en/models/9999991-plausible-hook", by: "not_found", inSearch: false },
        { url: "https://www.thingiverse.com/thing:9999992", by: "no_model", inSearch: true },
      ],
    });
    // MakerWorld's own "no such model" is the answer: its page isn't asked after it.
    expect(web.asked.some((url) => url.includes("/models/9999991-plausible-hook"))).toBe(false);
  });

  it("drops a link the Worker gets a plain 403 for, unless Claude's web fetch read the page in this answer", async () => {
    stubWeb(
      {
        json: { suggestions: [suggestion(MODELS.planter), suggestion(MODELS.vase)] },
        // Claude read the planter's page; the vase it never opened.
        blocks: fetchedBlock(
          `${MODELS.planter.url}`,
          "Planter with a saucer, read by Claude - Thingiverse",
          "A planter. ![photo](https://cdn.thingiverse.com/assets/planter.jpg) https://evil.example/x.jpg",
        ),
      },
      { forbidden: [MODELS.planter.url, MODELS.vase.url] },
    );
    expect(await scoutTick(env, wed)).toBe("done");
    const rows = await env.DB.prepare("SELECT key, title, picture_type FROM scout_picks").all<
      Record<string, unknown>
    >();
    // The title the fetch read, without the site's name; the picture from the site's image host in the page's text.
    expect(rows.results).toEqual([
      { key: "thingiverse:6100002", title: "Planter with a saucer, read by Claude", picture_type: "image/jpeg" },
    ]);
    expect(await detail()).toMatchObject({
      fetches: 1,
      dead: 1,
      deadBy: { http_403: 1 },
      aliveBy: { web_fetch: 1 },
      kept: 1,
    });
  });

  it("doesn't take a challenge or a soft 'not found' that Claude's web fetch read for a live page", async () => {
    stubWeb(
      {
        json: {
          suggestions: [
            suggestion(MODELS.clips),
            suggestion({ url: "https://www.thingiverse.com/thing:9999993", title: "Clip" }),
          ],
        },
        blocks: [
          ...fetchedBlock(MODELS.clips.url, "Just a moment..."),
          ...fetchedBlock("https://www.thingiverse.com/thing:9999993", "Thingiverse - The community for Open Hardware"),
        ],
      },
      { challenge: [MODELS.clips.url] },
    );
    expect(await scoutTick(env, wed)).toBe("nothing");
    expect((await rounds()).results[0]).toMatchObject({ status: "nothing", outcome: "all_dead" });
    expect(await detail()).toMatchObject({ dead: 2, deadBy: { challenge: 1, no_model: 1 }, kept: 0 });
  });

  it("takes a title and picture from the page itself, not Claude's words, and asks nothing else of the web", async () => {
    const web = stubWeb({
      json: {
        suggestions: [
          { ...suggestion(MODELS.drawer), title: "Totally different title", imageUrl: "https://evil.example/x.jpg" },
        ],
      },
    });
    expect(await scoutTick(env, wed)).toBe("done");
    const row = await env.DB.prepare("SELECT title FROM scout_picks").first<{ title: string }>();
    expect(row?.title).toBe(MODELS.drawer.title);
    expect(
      web.asked.filter((url) => !/cloudflare-dns|anthropic|makerworld\.com|bblmw\.com|thingiverse\.com/.test(url)),
    ).toEqual([]);
  });

  it("is quiet about a refusal and a broken call, and tries a stuck week only once more", async () => {
    stubWeb({ stopReason: "refusal" });
    expect(await scoutTick(env, wed)).toBe("failed");
    expect((await rounds()).results[0]).toMatchObject({ status: "failed", outcome: "refusal" });
    expect((await scout()).state).toBe("none");
    vi.restoreAllMocks();
    stubWeb({ status: 529 });
    await env.DB.prepare("DELETE FROM scout_rounds").run();
    expect(await scoutTick(env, wed)).toBe("failed");
    // A busy Claude is asked once more ten minutes on (the week isn't lost), never sooner, and never a third time.
    expect((await rounds()).results[0]).toMatchObject({ status: "thinking", outcome: "api_error" });
    expect(await scoutTick(env, wed + 5 * 60_000)).toBe("skipped");
    expect(await scoutTick(env, wed + 11 * 60_000)).toBe("failed");
    expect((await rounds()).results[0]).toMatchObject({ status: "failed", outcome: "api_error" });
    expect(await scoutTick(env, wed + 30 * 60_000)).toBe("skipped");
  });

  it("asks again after a busy Claude, and keeps the week", async () => {
    let calls = 0;
    stubWeb(() => (++calls === 1 ? { status: 529 } : good));
    expect(await scoutTick(env, wed)).toBe("failed");
    expect(await scoutTick(env, wed + 11 * 60_000)).toBe("done");
    expect((await env.DB.prepare("SELECT id FROM scout_picks").all()).results).toHaveLength(SCOUT_COUNT);
  });

  it("takes over a claim that went quiet once, and not a fresh one", async () => {
    stubWeb(good);
    await env.DB.prepare(
      "INSERT INTO scout_rounds (monday, status, claimed_at, tries, created_at) VALUES (?, 'thinking', ?, 1, ?)",
    )
      .bind(MONDAY, wed - 60_000, wed - 60_000)
      .run();
    expect(await scoutTick(env, wed)).toBe("skipped");
    expect(await scoutTick(env, wed + 11 * 60_000)).toBe("done");
  });

  it("gives up on a week whose claim died twice, and stops saying it is looking", async () => {
    stubWeb(good);
    await env.DB.prepare(
      "INSERT INTO scout_rounds (monday, status, claimed_at, tries, created_at) VALUES (?, 'thinking', ?, 2, ?)",
    )
      .bind(MONDAY, wed - 60_000, wed - 60_000)
      .run();
    expect(await scoutTick(env, wed + 11 * 60_000)).toBe("skipped");
  });

  it("keeps to a cap on runs a day", async () => {
    stubWeb(good);
    for (let week = 0; week < SCOUT_RUNS_PER_DAY; week++) {
      await env.DB.prepare(
        "INSERT INTO scout_rounds (monday, status, tries, created_at, ran_at) VALUES (?, 'done', 1, ?, ?)",
      )
        .bind(`2025-12-${String(1 + week * 7).padStart(2, "0")}`, wed, wed - 1000)
        .run();
    }
    expect(await scoutTick(env, wed)).toBe("failed");
    expect((await rounds()).results.find((r) => r.outcome === "cap")).toBeDefined();
  });

  it("never suggests a model again once it was kept or dismissed, or once it is an idea", async () => {
    stubWeb(good);
    await scoutTick(env, wed);
    const { results } = await env.DB.prepare("SELECT id, key FROM scout_picks ORDER BY position").all<{
      id: string;
      key: string;
    }>();
    // One is dismissed, one waits, and the third is already an idea (its link is in a note).
    await env.DB.prepare("UPDATE scout_picks SET status = 'dismissed' WHERE id = ?").bind(results[0]?.id).run();
    const nextMonday = at("2026-01-19T09:00:00+01:00");
    vi.restoreAllMocks();
    const web = stubWeb({
      json: {
        suggestions: [
          suggestion(MODELS.drawer),
          suggestion(MODELS.planter),
          suggestion(MODELS.clips),
          suggestion(MODELS.vase),
        ],
      },
    });
    await addIdea({ note: "https://makerworld.com/en/models/1100003-cable-chain-clips" });
    expect(await scoutTick(env, nextMonday)).toBe("done");
    const fresh = await env.DB.prepare("SELECT title FROM scout_picks WHERE monday = '2026-01-19'").all<{
      title: string;
    }>();
    expect(fresh.results.map((row) => row.title)).toEqual([MODELS.vase.title]);
    // And Claude was told what to leave out.
    const told = JSON.stringify(web.bodies[0]);
    expect(told).toContain(MODELS.drawer.title);
    expect(told).toContain("not for them");
  });

  it("does not read a wishlist its owner keeps private", async () => {
    const secret = await addIdea({ title: "Secret surprise gift", by: sam });
    await env.DB.prepare("INSERT INTO wishlist_entries (user_id, item_id, position, added_at) VALUES (?, ?, 0, ?)")
      .bind(sam, secret, wed)
      .run();
    await env.DB.prepare("UPDATE users SET wishlist_private = 1 WHERE id = ?").bind(sam).run();
    await env.DB.prepare("UPDATE items SET stage = 'building' WHERE id = ?").bind(secret).run();
    const web = stubWeb(good);
    await scoutTick(env, wed);
    expect(JSON.stringify(web.bodies[0])).not.toContain("Sam's wishlist");
  });
});

/** A week's picks, made and read the way the page reads them. */
async function scouted() {
  stubWeb(good);
  const now = vi.spyOn(Date, "now").mockReturnValue(wed);
  await scoutTick(env, wed);
  const round = await scout();
  now.mockRestore();
  return round;
}

describe("keeping and dismissing", () => {
  it("Keep makes an idea with the link and the picture, and drafts the rest from the link", async () => {
    const round = await scouted();
    expect(round.state).toBe("ready");
    const [pick] = round.picks as [ScoutPick];
    const picture = await asPerson(`/api/scout/${pick.id}/picture`);
    expect(picture.status).toBe(200);
    expect(picture.headers.get("content-type")).toBe("image/jpeg");

    const itemId = uuid();
    const kept = await asPerson(`/api/scout/${pick.id}/keep`, { method: "PUT", json: { itemId } });
    expect(kept.status).toBe(200);
    expect((await kept.json<{ pick: ScoutPick }>()).pick).toMatchObject({ status: "kept", itemId });
    const idea = (await (await asPerson(`/api/items/${itemId}`)).json<ItemResponse>()).item;
    expect(idea).toMatchObject({ stage: "idea", title: pick.title });
    expect(idea.note).toContain(pick.url);
    expect(idea.photos).toHaveLength(1);
    // The existing draft path was started from the link (the cron or waitUntil does the call).
    const draft = await env.DB.prepare("SELECT url, status FROM item_drafts WHERE item_id = ?")
      .bind(itemId)
      .first<{ url: string }>();
    expect(draft?.url).toBe(pick.url);
    // Asking again with the same id changes nothing; another idea for the same pick is refused.
    expect((await asPerson(`/api/scout/${pick.id}/keep`, { method: "PUT", json: { itemId } })).status).toBe(200);
    expect((await asPerson(`/api/scout/${pick.id}/keep`, { method: "PUT", json: { itemId: uuid() } })).status).toBe(
      409,
    );
    expect(
      (
        await env.DB.prepare("SELECT COUNT(*) AS n FROM items WHERE instr(note, ?) > 0")
          .bind(pick.url)
          .first<{ n: number }>()
      )?.n,
    ).toBe(1);
  });

  it("undoes a Keep: the idea goes to the bin and the suggestion is waiting again", async () => {
    const [pick] = (await scouted()).picks as [ScoutPick];
    const itemId = uuid();
    await asPerson(`/api/scout/${pick.id}/keep`, { method: "PUT", json: { itemId } });
    const undone = await asPerson(`/api/scout/${pick.id}/keep`, { method: "DELETE" });
    expect((await undone.json<{ pick: ScoutPick }>()).pick).toMatchObject({ status: "suggested", itemId: null });
    expect((await asPerson(`/api/items/${itemId}`)).status).toBe(404);
    // Keeping it again makes a fresh idea.
    const again = uuid();
    expect((await asPerson(`/api/scout/${pick.id}/keep`, { method: "PUT", json: { itemId: again } })).status).toBe(200);
    expect((await asPerson(`/api/items/${again}`)).status).toBe(200);
  });

  it("Not for us puts it away for good, with an undo, and nothing becomes an idea", async () => {
    const [pick] = (await scouted()).picks as [ScoutPick];
    const before = (await env.DB.prepare("SELECT COUNT(*) AS n FROM items").first<{ n: number }>())?.n;
    const gone = await asPerson(`/api/scout/${pick.id}/dismiss`, { method: "PUT" });
    expect((await gone.json<{ pick: ScoutPick }>()).pick.status).toBe("dismissed");
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM items").first<{ n: number }>())?.n).toBe(before);
    const back = await asPerson(`/api/scout/${pick.id}/dismiss`, { method: "DELETE" });
    expect((await back.json<{ pick: ScoutPick }>()).pick.status).toBe("suggested");
    // Doing either twice is harmless.
    await asPerson(`/api/scout/${pick.id}/dismiss`, { method: "PUT" });
    expect((await asPerson(`/api/scout/${pick.id}/dismiss`, { method: "PUT" })).status).toBe(200);
    expect((await asPerson(`/api/scout/${uuid()}/dismiss`, { method: "PUT" })).status).toBe(404);
  });

  it("is something agents may read and never act on", async () => {
    const [pick] = (await scouted()).picks as [ScoutPick];
    const made = await asPerson("/api/agents", {
      method: "POST",
      json: { name: "Claude", scopes: ["read", "capture", "attempts", "printer"] },
    });
    const token = (await made.json<NewTokenResponse>()).token;
    const as = (path: string, init: RequestInit = {}) =>
      request(path, { ...init, headers: { Authorization: `Bearer ${token}` } });
    expect((await as("/api/scout")).status).toBe(200);
    expect((await as(`/api/scout/${pick.id}/picture`)).status).toBe(200);
    for (const [method, path] of [
      ["PUT", `/api/scout/${pick.id}/dismiss`],
      ["DELETE", `/api/scout/${pick.id}/dismiss`],
      ["DELETE", `/api/scout/${pick.id}/keep`],
    ] as const) {
      expect((await as(path, { method })).status).toBe(403);
    }
    const keep = await request(`/api/scout/${pick.id}/keep`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ itemId: uuid() }),
    });
    expect(keep.status).toBe(403);
    expect(
      (await env.DB.prepare("SELECT status FROM scout_picks WHERE id = ?").bind(pick.id).first<{ status: string }>())
        ?.status,
    ).toBe("suggested");
  });

  it("runs the job straight too, and keeps the round's record", async () => {
    stubWeb(good);
    await env.DB.prepare(
      "INSERT INTO scout_rounds (monday, status, claimed_at, tries, created_at) VALUES (?, 'thinking', ?, 1, ?)",
    )
      .bind(MONDAY, wed, wed)
      .run();
    expect(await runScout(env, MONDAY, { now: wed })).toBe("done");
    expect(JSON.parse((await rounds()).results[0]?.detail ?? "{}")).toMatchObject({
      model: "claude-opus-5-5",
      kept: 3,
    });
  });
});
