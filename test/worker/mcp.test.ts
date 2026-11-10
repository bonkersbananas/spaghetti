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
      "capture_idea",
      "set_parts",
      "start_attempt",
      "log_attempt",
      "finish_attempt",
      "list_recipes",
      "list_spools",
      "weigh_spool",
      "load_slot",
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

    const fetched = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      expect(String(input)).toBe("https://example.com/boat.jpg");
      return new Response(
        Uint8Array.from(atob(jpegBase64()), (c) => c.charCodeAt(0)),
        { headers: { "Content-Type": "image/jpeg" } },
      );
    });
    try {
      const url = await callTool(made.token, "capture_idea", { photo_url: "https://example.com/boat.jpg" });
      expect(url.text).toContain("photo was added");
    } finally {
      fetched.mockRestore();
    }
    // A download with no (or a false) Content-Length is cut off at the cap, not buffered whole.
    let sent = 0;
    const endless = vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              sent += 1;
              controller.enqueue(new Uint8Array(1024 * 1024));
            },
          }),
          { headers: { "Content-Length": "100" } },
        ),
    );
    try {
      const huge = await callTool(made.token, "capture_idea", { photo_url: "https://example.com/huge.jpg" });
      expect(huge.isError).toBe(true);
      expect(huge.text).toContain("too large");
      expect(sent).toBeLessThan(20);
    } finally {
      endless.mockRestore();
    }
    expect((await callTool(made.token, "capture_idea", { photo_url: "http://example.com/boat.jpg" })).text).toContain(
      "https",
    );
    expect((await callTool(made.token, "capture_idea", { photo_base64: btoa("not an image at all") })).text).toContain(
      "JPEG or WebP",
    );
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
