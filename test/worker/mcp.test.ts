import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentScope, NewTokenResponse } from "../../src/shared/agents.ts";
import type { ItemResponse } from "../../src/shared/api.ts";
import type { ChangesResponse } from "../../src/shared/changes.ts";
import { addUser, request, resetDb, signIn } from "./helpers.ts";

let alex: string;
let cookie: string;

beforeEach(async () => {
  await resetDb();
  alex = await addUser("alex", "correct horse", "Alex Rivera", "tomato");
  cookie = await signIn("alex", "correct horse");
});

async function makeAgent(scopes: AgentScope[], name = "Claude for Alex") {
  const response = await request("/api/agents", { method: "POST", json: { name, scopes }, cookie });
  expect(response.status).toBe(201);
  return response.json<NewTokenResponse>();
}

interface Rpc {
  result?: {
    content?: Array<{ type: string; text: string }>;
    isError?: boolean;
    tools?: Array<Record<string, unknown>>;
    [key: string]: unknown;
  };
  error?: { code: number; message: string };
}

async function rpc(token: string | null, method: string, params?: unknown, id: number | null = 1) {
  const response = await request("/mcp", {
    method: "POST",
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), Accept: "application/json, text/event-stream" },
    json: { jsonrpc: "2.0", ...(id === null ? {} : { id }), method, params },
  });
  return { response, body: (response.status === 202 ? null : await response.json()) as Rpc };
}

async function callTool(token: string, name: string, args: Record<string, unknown> = {}) {
  const { body } = await rpc(token, "tools/call", { name, arguments: args });
  expect(body.error, JSON.stringify(body.error)).toBeUndefined();
  return { text: body.result?.content?.[0]?.text ?? "", isError: body.result?.isError === true };
}

const uuid = () => crypto.randomUUID();
const field = (text: string, key: string) => new RegExp(`${key}: ([0-9a-f-]{36})`).exec(text)?.[1] ?? "";

/** The smallest thing readImage accepts: JPEG start, a frame header saying 1600 × 1200. */
const jpegBase64 = () => {
  const bytes = new Uint8Array([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x04, 0xb0, 0x06, 0x40, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1,
  ]);
  return btoa(String.fromCharCode(...bytes));
};

const jpegResponse = () =>
  new Response(
    Uint8Array.from(atob(jpegBase64()), (c) => c.charCodeAt(0)),
    { headers: { "Content-Type": "image/jpeg" } },
  );

/** The web as the Worker sees it: answers by address, and DNS over HTTPS (public unless `dns` says otherwise). */
function stubWeb(pages: Record<string, () => Response>, dns: Record<string, string[]> = {}) {
  const asked: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    asked.push(url.href);
    if (url.hostname === "cloudflare-dns.com") {
      const type = url.searchParams.get("type");
      const answers = (dns[url.searchParams.get("name") ?? ""] ?? ["93.184.216.34"])
        .filter((address) => (type === "AAAA") === address.includes(":"))
        .map((data) => ({ type: type === "AAAA" ? 28 : 1, data }));
      return Response.json({ Status: 0, Answer: answers });
    }
    return pages[url.href]?.() ?? new Response("not found", { status: 404 });
  });
  return { pages: () => asked.filter((href) => !href.includes("cloudflare-dns.com")) };
}

describe("the MCP endpoint", () => {
  it("needs an agent token: nothing, a cookie, a bad or a revoked one is refused", async () => {
    expect((await rpc(null, "ping")).response.status).toBe(401);
    expect((await rpc("spg_nope", "ping")).response.status).toBe(401);
    const cookieOnly = await request("/mcp", {
      method: "POST",
      cookie,
      json: { jsonrpc: "2.0", id: 1, method: "ping" },
    });
    expect(cookieOnly.status).toBe(401);
    const made = await makeAgent(["read"]);
    expect((await rpc(made.token, "ping")).response.status).toBe(200);
    await request(`/api/agents/${made.agent.id}/tokens/${made.tokenId}`, { method: "DELETE", cookie });
    const refused = await rpc(made.token, "ping");
    expect(refused.response.status).toBe(401);
    expect(refused.response.headers.get("WWW-Authenticate")).toContain("Bearer");
  });

  it("is stateless Streamable HTTP: POST only, notifications accepted, versions negotiated", async () => {
    const made = await makeAgent(["read"]);
    for (const method of ["GET", "DELETE"]) {
      const response = await request("/mcp", { method, headers: { Authorization: `Bearer ${made.token}` } });
      expect(response.status).toBe(405);
      expect(response.headers.get("Allow")).toBe("POST");
    }
    const init = await rpc(made.token, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    expect(init.body.result).toMatchObject({
      protocolVersion: "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "spaghetti" },
    });
    expect((await rpc(made.token, "initialize", { protocolVersion: "1999-01-01" })).body.result?.protocolVersion).toBe(
      "2025-11-25",
    );
    expect((await rpc(made.token, "notifications/initialized", undefined, null)).response.status).toBe(202);
    expect((await rpc(made.token, "nothing/here")).body.error?.code).toBe(-32601);
    expect((await rpc(made.token, "tools/call", { name: "nope" })).body.error?.code).toBe(-32602);
    const garbage = await request("/mcp", {
      method: "POST",
      headers: { Authorization: `Bearer ${made.token}` },
      body: "{",
    });
    expect(garbage.status).toBe(400);
  });

  it("lists the tools with schemas a model can use", async () => {
    const made = await makeAgent(["read"]);
    const { body } = await rpc(made.token, "tools/list");
    const listed = body.result?.tools ?? [];
    expect(listed.map((tool) => tool.name)).toEqual([
      "search",
      "what_worked",
      "get_build",
      "get_photo",
      "capture_idea",
      "add_photo",
      "add_comment",
      "set_parts",
      "start_attempt",
      "log_attempt",
      "finish_attempt",
      "list_recipes",
      "list_twists",
      "add_twist",
      "list_scout_suggestions",
      "list_spools",
      "weigh_spool",
      "load_slot",
      "get_week",
      "list_upkeep",
      "log_upkeep",
    ]);
    for (const tool of listed) {
      expect(tool.description, String(tool.name)).toMatch(/scope/);
      expect(tool.inputSchema).toMatchObject({ type: "object" });
    }
    const log = listed.find((tool) => tool.name === "log_attempt") as {
      inputSchema: { properties: Record<string, unknown>; required: string[] };
    };
    expect(log.inputSchema.required).toEqual(expect.arrayContaining(["build_id", "outcome"]));
    expect(log.inputSchema.properties).toHaveProperty("settings");
  });
});

describe("tools, scopes and attribution", () => {
  it("capture_idea needs capture, and is recorded as the owner's work via the agent", async () => {
    const made = await makeAgent(["capture"]);
    const before = (await (await request("/api/changes", { cookie })).json<ChangesResponse>()).cursor;
    const result = await callTool(made.token, "capture_idea", {
      title: "Spool holder",
      note: "Roller type, 608 bearings",
    });
    expect(result.isError).toBe(false);
    const itemId = field(result.text, "build_id");
    const item = (await (await request(`/api/items/${itemId}`, { cookie })).json<ItemResponse>()).item;
    expect(item).toMatchObject({
      title: "Spool holder",
      note: "Roller type, 608 bearings",
      createdBy: alex,
      createdVia: made.agent.id,
    });
    const feed = (await (await request(`/api/changes?after=${before}`, { cookie })).json<ChangesResponse>()).changes;
    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatchObject({
      entity: "item",
      action: "created",
      id: itemId,
      actor: { kind: "agent", id: made.agent.id },
    });

    const refused = await callTool((await makeAgent(["read", "attempts", "printer"], "other")).token, "capture_idea", {
      note: "x",
    });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain('"capture"');
    expect((await callTool(made.token, "capture_idea", {})).isError).toBe(true);
  });

  it("add_twist needs capture, keeps the changes, and list_twists reads them", async () => {
    const made = await makeAgent(["capture", "read"]);
    const result = await callTool(made.token, "add_twist", {
      name: "Drawer bins, 42 mm grid",
      source_url: "https://makerworld.com/en/models/487213-drawer-bins",
      changes: [
        { kind: "scale", value: "84 %", note: "fits the 42 mm grid" },
        { kind: "tolerance", value: "+0.2 mm" },
      ],
    });
    expect(result.isError).toBe(false);
    const twistId = field(result.text, "twist_id");
    const listed = await callTool(made.token, "list_twists", {});
    expect(listed.text).toContain(`twist_id: ${twistId}`);
    expect(listed.text).toContain("Scale 84 % · Fit tolerance +0.2 mm");
    expect(listed.text).toContain("(MakerWorld)");
    // Search finds it too, in its own group.
    expect((await callTool(made.token, "search", { query: "drawer" })).text).toContain("Twists:");
    const readOnly = (await makeAgent(["read"], "reader")).token;
    expect((await callTool(readOnly, "add_twist", { name: "x" })).isError).toBe(true);
  });

  it("capture_idea attaches a photo from base64 or an https URL, and refuses the rest", async () => {
    const made = await makeAgent(["capture"]);
    const base64 = await callTool(made.token, "capture_idea", { note: "With a photo", photo_base64: jpegBase64() });
    expect(base64.text).toContain("photo was added");
    const itemId = field(base64.text, "build_id");
    const { item } = await (await request(`/api/items/${itemId}`, { cookie })).json<ItemResponse>();
    expect(item.photos).toHaveLength(1);
    expect(item.photos[0]).toMatchObject({ width: 1600, height: 1200 });
    const stored = await env.PHOTOS.get(`photos/${item.photos[0]?.id}/large`);
    expect(stored).not.toBeNull();

    const fetched = stubWeb({ "https://example.com/boat.jpg": () => jpegResponse() });
    try {
      const url = await callTool(made.token, "capture_idea", { photo_url: "https://example.com/boat.jpg" });
      expect(url.text).toContain("photo was added");
      expect(fetched.pages()).toEqual(["https://example.com/boat.jpg"]);
    } finally {
      vi.restoreAllMocks();
    }
    // A download with no (or a false) Content-Length is cut off at the cap, not buffered whole.
    let sent = 0;
    stubWeb({
      "https://example.com/huge.jpg": () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              sent += 1;
              controller.enqueue(new Uint8Array(1024 * 1024));
            },
          }),
          { headers: { "Content-Length": "100" } },
        ),
    });
    try {
      const huge = await callTool(made.token, "capture_idea", { photo_url: "https://example.com/huge.jpg" });
      expect(huge.isError).toBe(true);
      expect(huge.text).toContain("too large");
      expect(sent).toBeLessThan(20);
    } finally {
      vi.restoreAllMocks();
    }
    expect((await callTool(made.token, "capture_idea", { photo_url: "http://example.com/boat.jpg" })).text).toContain(
      "https",
    );
    expect((await callTool(made.token, "capture_idea", { photo_base64: btoa("not an image at all") })).text).toContain(
      "JPEG or WebP",
    );
  });

  it("checks the tool's scopes before it runs: a token without them makes the Worker fetch nothing", async () => {
    const fetched = vi.spyOn(globalThis, "fetch");
    try {
      for (const scopes of [["read"], ["attempts", "printer"]] as AgentScope[][]) {
        const { token } = await makeAgent(scopes, scopes.join(" "));
        const refused = await callTool(token, "capture_idea", { photo_url: "https://example.com/boat.jpg" });
        expect(refused).toEqual({ text: 'This token needs the "capture" scope for that.', isError: true });
      }
      expect(fetched).not.toHaveBeenCalled();
    } finally {
      fetched.mockRestore();
    }
    // Every tool is refused the same way to a token with none of its scopes.
    const { token } = await makeAgent(["printer"], "printer only");
    const { body } = await rpc(token, "tools/list");
    for (const tool of body.result?.tools ?? []) {
      const result = await callTool(token, String(tool.name), {});
      if (String(tool.description).includes('"printer"')) continue;
      expect(result.text, String(tool.name)).toMatch(/^This token needs the .* scope for that\.$/);
    }
  });

  it("capture_idea fetches a photo only from the open internet, on every hop", async () => {
    const { token } = await makeAgent(["capture"]);
    const web = stubWeb(
      {
        "https://example.com/moved.jpg": () => Response.redirect("http://192.168.1.20/snapshot.jpg", 302),
        "https://example.com/indoors.jpg": () => Response.redirect("https://camera.example.com/snapshot.jpg", 302),
        "https://camera.example.com/snapshot.jpg": () => jpegResponse(),
      },
      { "camera.example.com": ["10.0.0.20"], "rebind.example.com": ["93.184.216.34", "::1"] },
    );
    try {
      for (const url of [
        "http://example.com/boat.jpg",
        "https://127.0.0.1/boat.jpg",
        "https://[::1]/boat.jpg",
        "https://localhost/boat.jpg",
        "https://printer.local/boat.jpg",
        "https://example.com:8080/boat.jpg",
        "https://user:pass@example.com/boat.jpg",
        "https://rebind.example.com/boat.jpg",
        "https://example.com/moved.jpg",
        "https://example.com/indoors.jpg",
      ]) {
        const result = await callTool(token, "capture_idea", { photo_url: url });
        expect(result, url).toEqual({
          text: "The photo URL must be an https address on the open internet.",
          isError: true,
        });
      }
      // Only the two public addresses were asked for anything; the private ones never.
      expect(new Set(web.pages())).toEqual(
        new Set(["https://example.com/moved.jpg", "https://example.com/indoors.jpg"]),
      );
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("set_parts adds parts and the attempt tools take their counts", async () => {
    const owner = await makeAgent(["capture", "attempts", "read"]);
    const build = field((await callTool(owner.token, "capture_idea", { title: "Tugboat" })).text, "build_id");
    const set = await callTool(owner.token, "set_parts", {
      build_id: build,
      parts: [
        { name: "Hull half", quantity: 2 },
        { name: "Deck", quantity: 1 },
      ],
    });
    expect(set.isError).toBe(false);
    const { item } = await (await request(`/api/items/${build}`, { cookie })).json<ItemResponse>();
    const hull = item.parts.find((part) => part.name === "Hull half");
    expect(hull?.quantity).toBe(2);
    const started = await callTool(owner.token, "start_attempt", {
      build_id: build,
      parts: [{ part_id: hull?.id, count: 2 }],
    });
    const finished = await callTool(owner.token, "finish_attempt", {
      attempt_id: field(started.text, "attempt_id"),
      outcome: "partial",
      parts: [{ part_id: hull?.id, count: 1 }],
    });
    expect(finished.isError).toBe(false);
    const logged = await callTool(owner.token, "log_attempt", {
      build_id: build,
      outcome: "success",
      parts: [{ part_id: hull?.id, count: 1 }],
    });
    expect(logged.isError).toBe(false);
    const story = await callTool(owner.token, "get_build", { build_id: build });
    expect(story.text).toContain("- Hull half ×2: done");
    expect(story.text).toContain("- Deck ×1: 0 of 1");
  });

  it("get_build lists the slicer files kept with an idea", async () => {
    const owner = await makeAgent(["capture", "read"]);
    const idea = field((await callTool(owner.token, "capture_idea", { title: "Bin" })).text, "build_id");
    const form = new FormData();
    form.set("name", "Bin.gcode.3mf");
    form.set("size", "4");
    form.set("plate", "2");
    form.set("plateCount", "3");
    form.set("prefill", JSON.stringify({ estimatedMinutes: 90 }));
    form.set("file", new File([new Uint8Array([1, 2, 3, 4])], "Bin.gcode.3mf"));
    const put = await request(`/api/items/${idea}/files/${crypto.randomUUID()}`, {
      method: "PUT",
      body: form,
      headers: { Authorization: `Bearer ${owner.token}` },
    });
    expect(put.status).toBe(201);
    const story = await callTool(owner.token, "get_build", { build_id: idea });
    expect(story.text).toContain("## Files (1)");
    expect(story.text).toContain("- Bin.gcode.3mf (plate 2 of 3, est. 1 h 30 min)");
  });

  it("start_attempt, log_attempt and finish_attempt need attempts, and say via", async () => {
    const owner = await makeAgent(["capture", "attempts", "read"]);
    const idea = field((await callTool(owner.token, "capture_idea", { title: "Cable chain" })).text, "build_id");

    const started = await callTool(owner.token, "start_attempt", {
      build_id: idea,
      note: "Slower first layer",
      settings: { layerHeight: 0.2, bedTemperature: 60 },
    });
    expect(started.isError).toBe(false);
    const attemptId = field(started.text, "attempt_id");
    const finished = await callTool(owner.token, "finish_attempt", {
      attempt_id: attemptId,
      outcome: "failed",
      failure_tags: ["warping"],
      note: "Corners lifted",
    });
    expect(finished.text).toContain("Finished: Spaghetti");
    const logged = await callTool(owner.token, "log_attempt", {
      build_id: idea,
      outcome: "success",
      success_notes: ["great-first-layer"],
      settings: { bedTemperature: 70, brim: true },
    });
    expect(logged.text).toContain("Logged: Worked");

    const { item } = await (await request(`/api/items/${idea}`, { cookie })).json<ItemResponse>();
    expect(item.stage).toBe("building");
    expect(item.attempts).toHaveLength(2);
    expect(item.attempts[0]).toMatchObject({
      outcome: "failed",
      failureTags: ["warping"],
      createdVia: owner.agent.id,
      finishedVia: owner.agent.id,
      finishedBy: alex,
    });
    expect(item.attempts[1]).toMatchObject({ outcome: "success", settings: { bedTemperature: 70, brim: true } });
    const row = await env.DB.prepare(
      "SELECT actor_kind AS kind, actor_id AS id FROM changes WHERE entity = 'attempt' ORDER BY seq",
    ).all<{ kind: string; id: string }>();
    expect(row.results.every((r) => r.kind === "agent" && r.id === owner.agent.id)).toBe(true);
    expect(row.results.length).toBe(3);

    // Finishing what someone else finished keeps their outcome.
    const again = await callTool(owner.token, "finish_attempt", { attempt_id: attemptId, outcome: "success" });
    expect(again.text).toContain("already finished");

    for (const scope of ["read", "capture", "printer"] as const) {
      const other = (await makeAgent([scope], `${scope} only`)).token;
      for (const [name, args] of [
        ["start_attempt", { build_id: idea }],
        ["log_attempt", { build_id: idea, outcome: "success" }],
        ["finish_attempt", { attempt_id: attemptId, outcome: "success" }],
      ] as const) {
        const refused = await callTool(other, name, args);
        expect(refused.isError, `${scope} → ${name}`).toBe(true);
        expect(refused.text).toContain('"attempts"');
      }
    }
    // Arguments are checked with the model told what is wrong.
    const bad = await callTool(owner.token, "log_attempt", { build_id: "nope", outcome: "great" });
    expect(bad.isError).toBe(true);
    expect(bad.text).toMatch(/build_id/);
  });

  it("add_comment writes to the thread for the owner, via the agent, and get_build shows it", async () => {
    const owner = await makeAgent(["read", "capture"]);
    const idea =
      (await callTool(owner.token, "capture_idea", { title: "Hook" })).text.match(/[0-9a-f-]{36}/)?.[0] ?? "";
    const added = await callTool(owner.token, "add_comment", { build_id: idea, text: "Should it be blue?" });
    expect(added.isError).toBeFalsy();
    const story = await callTool(owner.token, "get_build", { build_id: idea });
    expect(story.text).toMatch(/## Comments[\s\S]*Should it be blue\?/);
    expect(story.text).toMatch(/via /);
    const printerOnly = await makeAgent(["read", "printer"], "printer only");
    const refused = await callTool(printerOnly.token, "add_comment", { build_id: idea, text: "Hi" });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain('"capture"');
  });

  it("search, what_worked and get_build read with read, and refuse without it", async () => {
    const writer = await makeAgent(["capture", "attempts", "read"], "Claude for Alex");
    const idea = field(
      (await callTool(writer.token, "capture_idea", { title: "Hose clip", note: "For the filament dryer" })).text,
      "build_id",
    );
    await callTool(writer.token, "log_attempt", {
      build_id: idea,
      outcome: "failed",
      failure_tags: ["warping"],
      note: "Corners lifted",
      settings: { filaments: [{ type: "PETG", brand: "Bambu", colorName: "Teal" }], bedTemperature: 70 },
    });
    await callTool(writer.token, "log_attempt", {
      build_id: idea,
      outcome: "success",
      success_notes: ["great-first-layer"],
      note: "Brim fixed it",
      settings: { filaments: [{ type: "PETG", brand: "Bambu", colorName: "Teal" }], bedTemperature: 80, brim: true },
    });

    const found = await callTool(writer.token, "search", { query: "hose" });
    expect(found.text).toContain("Hose clip");
    expect(found.text).toContain(`build_id: ${idea}`);
    const failures = await callTool(writer.token, "search", { outcome: "failures", material: "PETG" });
    expect(failures.text).toContain("Corners lifted");
    expect(failures.text).not.toContain("Brim fixed it");
    expect((await callTool(writer.token, "search", {})).text).toContain("Nothing found");

    const worked = await callTool(writer.token, "what_worked", { build_id: idea });
    expect(worked.text).toContain("Brim fixed it");
    expect(worked.text).toContain("bed 80 °C");
    expect(worked.text).not.toContain("Corners lifted");
    expect((await callTool(writer.token, "what_worked", { material: "PETG" })).text).toContain("Brim fixed it");
    expect((await callTool(writer.token, "what_worked", { query: "brim" })).text).toContain("Brim fixed it");
    expect((await callTool(writer.token, "what_worked", {})).isError).toBe(true);

    const story = await callTool(writer.token, "get_build", { build_id: idea });
    expect(story.text).toContain("# Hose clip");
    expect(story.text).toContain("Attempt 2: Worked");
    expect((await callTool(writer.token, "get_build", { build_id: uuid() })).isError).toBe(true);

    const blind = (await makeAgent(["capture", "attempts", "printer"], "no read")).token;
    for (const [name, args] of [
      ["search", { query: "hose" }],
      ["what_worked", { build_id: idea }],
      ["get_build", { build_id: idea }],
      ["list_recipes", {}],
      ["list_twists", {}],
      ["list_scout_suggestions", {}],
      ["list_spools", {}],
    ] as const) {
      const refused = await callTool(blind, name, args);
      expect(refused.isError, name).toBe(true);
      expect(refused.text, name).toContain('"read"');
    }
  });

  it("list_spools and load_slot: read to see, printer to change, via the agent", async () => {
    const bridge = await makeAgent(["read", "printer"], "Printer bridge");
    const spoolId = uuid();
    await request("/api/spools", {
      method: "POST",
      json: { id: spoolId, material: "PLA", brand: "Bambu", colorName: "Jade white", remaining: "half" },
      cookie,
    });
    const listed = await callTool(bridge.token, "list_spools");
    expect(listed.text).toContain("Bambu PLA Jade white");
    expect(listed.text).toContain(`spool_id: ${spoolId}`);

    const before = (await (await request("/api/changes", { cookie })).json<ChangesResponse>()).cursor;
    expect((await callTool(bridge.token, "load_slot", { slot: "A2", spool_id: spoolId })).text).toBe("Loaded into A2.");
    expect((await callTool(bridge.token, "list_spools")).text).toContain("loaded in A2");
    const feed = (await (await request(`/api/changes?after=${before}`, { cookie })).json<ChangesResponse>()).changes;
    expect(feed[0]).toMatchObject({ entity: "slot", id: "A2", actor: { kind: "agent", id: bridge.agent.id } });
    expect((await callTool(bridge.token, "load_slot", { slot: "A2", spool_id: null })).text).toBe("A2 is now empty.");
    expect((await callTool(bridge.token, "load_slot", { slot: "Z9", spool_id: spoolId })).isError).toBe(true);

    const gramsSpool = uuid();
    await request("/api/spools", {
      method: "POST",
      json: { id: gramsSpool, material: "PETG", netGrams: 1000 },
      cookie,
    });
    expect(
      (await callTool(bridge.token, "weigh_spool", { spool_id: gramsSpool, on_scale: 812, tare_grams: 250 })).text,
    ).toBe("Weighed: about 562 g left.");
    expect((await callTool(bridge.token, "list_spools")).text).toContain("about 562 g left");
    expect((await callTool(bridge.token, "weigh_spool", { spool_id: gramsSpool })).isError).toBe(true);

    const week = await callTool(bridge.token, "get_week", { monday: "2026-03-02" });
    expect(week.text).toContain("Week of 2026-03-02 to 2026-03-08.");
    expect(week.text).toContain("No prints.");
    expect((await callTool(bridge.token, "get_week", { monday: "2026-03-03" })).isError).toBe(true);

    const upkeepList = await callTool(bridge.token, "list_upkeep");
    expect(upkeepList.text).toContain("Clean the build plate");
    expect(upkeepList.text).toContain("(task_id: plate)");
    expect((await callTool(bridge.token, "log_upkeep", { task_id: "plate", note: "Soap" })).text).toBe(
      "Logged: Clean the build plate.",
    );
    expect((await callTool(bridge.token, "log_upkeep", { task_id: "nope" })).isError).toBe(true);

    const reader = (await makeAgent(["read", "capture", "attempts"], "reader")).token;
    const refused = await callTool(reader, "load_slot", { slot: "A1", spool_id: spoolId });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain('"printer"');
    expect((await callTool((await makeAgent(["printer"], "p")).token, "list_spools")).text).toContain('"read"');
  });
});

describe("photos through MCP", () => {
  async function full(token: string, name: string, args: Record<string, unknown>) {
    const { body } = await rpc(token, "tools/call", { name, arguments: args });
    const content = (body.result?.content ?? []) as Array<{
      type: string;
      text?: string;
      data?: string;
      mimeType?: string;
    }>;
    return {
      isError: body.result?.isError === true,
      text: content.find((part) => part.type === "text")?.text ?? "",
      images: content.filter((part) => part.type === "image"),
    };
  }

  async function ideaWithPhoto(token: string) {
    const made = await callTool(token, "capture_idea", { title: "Tugboat", photo_base64: jpegBase64() });
    const buildId = field(made.text, "build_id");
    const { item } = await (await request(`/api/items/${buildId}`, { cookie })).json<ItemResponse>();
    return { buildId, photoId: item.photos[0]?.id ?? "" };
  }

  it("get_build lists the photos and get_photo returns them as image content", async () => {
    const { token } = await makeAgent(["read", "capture", "attempts"]);
    const { buildId, photoId } = await ideaWithPhoto(token);
    const attempt = await callTool(token, "log_attempt", {
      build_id: buildId,
      outcome: "success",
      photo_base64: jpegBase64(),
    });
    expect(attempt.text).toContain("photo was added");
    const story = await callTool(token, "get_build", { build_id: buildId });
    expect(story.text).toContain("## Photos (2)");
    expect(story.text).toContain(`photo_id: ${photoId} (the idea/build`);
    expect(story.text).toContain("attempt 1");
    expect(story.text).toContain("1600×1200");

    const one = await full(token, "get_photo", { build_id: buildId, photo_id: photoId });
    expect(one.images).toEqual([{ type: "image", data: jpegBase64(), mimeType: "image/jpeg" }]);
    const byAttempt = await full(token, "get_photo", { build_id: buildId, attempt: 1 });
    expect(byAttempt.images).toHaveLength(1);
    expect(byAttempt.text).toContain("attempt 1");
    const several = await full(token, "get_photo", { build_id: buildId, limit: 4 });
    expect(several.images).toHaveLength(1);
    expect((await full(token, "get_photo", { build_id: buildId, attempt: 5 })).isError).toBe(true);
    // Search names an attempt's photo.
    const found = await callTool(token, "search", { outcome: "success" });
    expect(found.text).toContain("photo_id:");
  });

  it("get_photo needs read, and refuses a photo that isn't the build's, or is deleted", async () => {
    const { token } = await makeAgent(["read", "capture"]);
    const first = await ideaWithPhoto(token);
    const second = await ideaWithPhoto(token);
    const wrong = await full(token, "get_photo", { build_id: first.buildId, photo_id: second.photoId });
    expect(wrong).toMatchObject({ isError: true, images: [] });
    expect(wrong.text).toContain("isn't one of this build's");
    expect((await full(token, "get_photo", { build_id: first.buildId, photo_id: uuid() })).isError).toBe(true);

    const noRead = await makeAgent(["capture"], "writer");
    expect((await full(noRead.token, "get_photo", { build_id: first.buildId })).text).toContain('"read"');

    // A removed photo and a removed idea are gone for the agent too.
    await request(`/api/photos/${first.photoId}`, { method: "DELETE", cookie });
    expect((await full(token, "get_photo", { build_id: first.buildId, photo_id: first.photoId })).isError).toBe(true);
    await request(`/api/items/${second.buildId}`, { method: "DELETE", cookie });
    expect((await full(token, "get_photo", { build_id: second.buildId })).isError).toBe(true);
  });

  it("get_photo keeps pictures small: a big original is replaced by the thumb, or left out", async () => {
    const { token } = await makeAgent(["read", "capture"]);
    const { buildId, photoId } = await ideaWithPhoto(token);
    const small = Uint8Array.from(atob(jpegBase64()), (c) => c.charCodeAt(0));
    const big = new Uint8Array(1_000_000);
    big.set(small);
    // An original no browser has resized is both sizes in one: the thumb is only asked for after a resize.
    const unresized = await full(token, "get_photo", { build_id: buildId });
    expect(unresized.images).toHaveLength(1);
    await env.DB.prepare("UPDATE photos SET needs_resize = 0 WHERE id = ?").bind(photoId).run();
    await env.PHOTOS.put(`photos/${photoId}/large`, big, { httpMetadata: { contentType: "image/jpeg" } });
    const thumb = await full(token, "get_photo", { build_id: buildId });
    expect(thumb.images).toHaveLength(1);
    expect(thumb.images[0]?.data).toBe(jpegBase64());
    await env.PHOTOS.put(`photos/${photoId}/thumb`, big, { httpMetadata: { contentType: "image/jpeg" } });
    const none = await full(token, "get_photo", { build_id: buildId });
    expect(none.images).toHaveLength(0);
    expect(none.text).toContain("too big");
  });

  it("add_photo adds to an idea or an attempt, after the others, marked via the agent", async () => {
    const { token } = await makeAgent(["capture", "attempts"], "Claude for Alex");
    const { buildId } = await ideaWithPhoto(token);
    const added = await callTool(token, "add_photo", { build_id: buildId, photo_base64: jpegBase64() });
    expect(added.text).toContain("Photo added");
    const attempt = field(
      (await callTool(token, "log_attempt", { build_id: buildId, outcome: "failed" })).text,
      "attempt_id",
    );
    const onAttempt = await callTool(token, "add_photo", {
      build_id: buildId,
      attempt_id: attempt,
      photo_base64: jpegBase64(),
    });
    expect(onAttempt.text).toContain("Photo added");
    const { item } = await (await request(`/api/items/${buildId}`, { cookie })).json<ItemResponse>();
    expect(item.photos.map((p) => [p.position, p.attemptId])).toEqual([
      [0, null],
      [1, null],
      [2, attempt],
    ]);
    expect(item.photos.every((p) => p.needsResize && p.createdBy === alex)).toBe(true);
    const rows = await env.DB.prepare("SELECT actor_kind FROM changes WHERE entity = 'photo'").all<{
      actor_kind: string;
    }>();
    expect(rows.results.length).toBeGreaterThanOrEqual(3);
    expect(rows.results.every((row) => row.actor_kind === "agent")).toBe(true);

    // finish_attempt takes a photo as well.
    const printing = field((await callTool(token, "start_attempt", { build_id: buildId })).text, "attempt_id");
    const finished = await callTool(token, "finish_attempt", {
      attempt_id: printing,
      outcome: "success",
      photo_base64: jpegBase64(),
    });
    expect(finished.text).toContain("photo was added");
  });

  it("add_photo checks scopes, the build, the attempt and the photo before anything is fetched for a token that can't use them", async () => {
    const owner = await makeAgent(["capture", "attempts"], "owner");
    const { buildId } = await ideaWithPhoto(owner.token);
    const web = stubWeb({ "https://example.com/boat.jpg": () => jpegResponse() });
    const url = "https://example.com/boat.jpg";
    try {
      const readOnly = await makeAgent(["read"], "reader");
      expect((await callTool(readOnly.token, "add_photo", { build_id: buildId, photo_url: url })).text).toContain(
        "needs the",
      );
      // A capture token can't put a photo on an attempt, and nothing is fetched for it.
      const capture = await makeAgent(["capture"], "capturer");
      const refused = await callTool(capture.token, "add_photo", {
        build_id: buildId,
        attempt_id: uuid(),
        photo_url: url,
      });
      expect(refused).toEqual({ text: 'This token needs the "attempts" scope for that.', isError: true });
      // An attempt token can't add to the idea itself.
      const attemptsOnly = await makeAgent(["attempts"], "attempter");
      expect((await callTool(attemptsOnly.token, "add_photo", { build_id: buildId, photo_url: url })).isError).toBe(
        true,
      );
      expect(web.pages()).toEqual([]);
      // A build that isn't there, a deleted one, an attempt that isn't the build's.
      expect((await callTool(owner.token, "add_photo", { build_id: uuid(), photo_url: url })).isError).toBe(true);
      expect(
        (await callTool(owner.token, "add_photo", { build_id: buildId, attempt_id: uuid(), photo_url: url })).text,
      ).toContain("isn't here");
      expect((await callTool(owner.token, "add_photo", { build_id: buildId })).isError).toBe(true);
      const gone = field((await callTool(owner.token, "capture_idea", { title: "Gone" })).text, "build_id");
      await request(`/api/items/${gone}`, { method: "DELETE", cookie });
      expect((await callTool(owner.token, "add_photo", { build_id: gone, photo_url: url })).isError).toBe(true);

      // A URL works, and is fetched only from the open internet.
      const ok = await callTool(owner.token, "add_photo", { build_id: buildId, photo_url: url });
      expect(ok.text).toContain("Photo added");
      expect(web.pages().at(-1)).toBe(url);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("add_photo enforces the size cap, the type and URL safety on redirects", async () => {
    const { token } = await makeAgent(["capture"]);
    const { buildId } = await ideaWithPhoto(token);
    const tooBig = btoa(String.fromCharCode(0xff, 0xd8, 0xff).padEnd(13 * 1024 * 1024, "a"));
    expect((await callTool(token, "add_photo", { build_id: buildId, photo_base64: tooBig })).text).toContain(
      "too large",
    );
    expect((await callTool(token, "add_photo", { build_id: buildId, photo_base64: btoa("nope") })).text).toContain(
      "JPEG or WebP",
    );
    stubWeb({ "https://example.com/moved.jpg": () => Response.redirect("http://192.168.1.20/snapshot.jpg", 302) });
    try {
      for (const url of ["https://example.com/moved.jpg", "https://127.0.0.1/a.jpg", "http://example.com/a.jpg"]) {
        const result = await callTool(token, "add_photo", { build_id: buildId, photo_url: url });
        expect(result.isError, url).toBe(true);
      }
    } finally {
      vi.restoreAllMocks();
    }
    const { item } = await (await request(`/api/items/${buildId}`, { cookie })).json<ItemResponse>();
    expect(item.photos).toHaveLength(1);
  });
});
