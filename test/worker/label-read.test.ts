import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NewTokenResponse } from "../../src/shared/agents.ts";
import type { FeaturesResponse, LabelReadResponse, Spool, SpoolResponse } from "../../src/shared/api.ts";
import { LABEL_READS_PER_DAY } from "../../src/shared/label-read.ts";
import { app } from "../../src/worker/app.ts";
import { resumeLabelReads, STALE_MS } from "../../src/worker/label-read/run.ts";
import { addUser, ORIGIN, request, resetDb, signIn } from "./helpers.ts";

type Answer = { spools?: unknown[]; json?: unknown; stopReason?: string; status?: number };

const none = {
  brand: null,
  material: null,
  variant: null,
  colorName: null,
  colorHex: null,
  netGrams: null,
  diameterMm: null,
  nozzleTempMin: null,
  nozzleTempMax: null,
  bedTempMin: null,
  bedTempMax: null,
  dryTempC: null,
  dryHours: null,
  productCode: null,
};
const jade = {
  ...none,
  brand: "Bambu Lab",
  material: "PLA",
  variant: "Basic",
  colorName: "Jade White",
  colorHex: "#F4F1EA",
  netGrams: 1000,
  diameterMm: 1.75,
  nozzleTempMin: 190,
  nozzleTempMax: 230,
  bedTempMin: 45,
  bedTempMax: 65,
  dryTempC: 55,
  dryHours: 8,
  productCode: "10100",
};
const petg = { ...none, brand: "Bambu Lab", material: "PETG", variant: "HF", colorName: "Black", netGrams: 1000 };

/** Stubs the Anthropic API; Responses are made inside the stub (a Response can't cross requests). */
function stubClaude(answer: Answer | (() => Answer) = { spools: [jade] }) {
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
      content:
        next.stopReason === "refusal"
          ? []
          : [{ type: "text", text: JSON.stringify(next.json ?? { spools: next.spools }) }],
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

async function makeSpool(fields: Record<string, unknown> = {}, photo = true) {
  const id = uuid();
  const made = await asPerson("/api/spools", { method: "POST", json: { id, material: "PLA", ...fields } });
  expect(made.status).toBe(201);
  if (photo) {
    const form = new FormData();
    form.set("width", "1200");
    form.set("height", "1600");
    form.set("color", "#a08060");
    form.set("large", new File([new Uint8Array([1, 2, 3, 4])], "large.webp", { type: "image/webp" }));
    form.set("thumb", new File([new Uint8Array([5, 6])], "thumb.webp", { type: "image/webp" }));
    const put = await asPerson(`/api/spools/${id}/photo/${uuid()}`, { method: "PUT", body: form });
    expect(put.status).toBe(200);
  }
  return id;
}
const getSpool = async (id: string) => (await (await asPerson(`/api/spools/${id}`)).json<SpoolResponse>()).spool;
const readLabel = (id: string, json: unknown = {}) =>
  asPerson(`/api/spools/${id}/label-read`, { method: "POST", json });
/** Waits for the read that runs after the response. */
const settled = (id: string) =>
  vi.waitFor(
    async () => {
      const spool = await getSpool(id);
      expect(spool.labelRead?.status).not.toBe("reading");
      return spool;
    },
    { timeout: 5000 },
  );
const runRows = async () =>
  (await env.DB.prepare("SELECT status, run_outcome, detail, ran_at FROM label_reads").all()).results as Array<{
    status: string;
    run_outcome: string;
    detail: string;
    ran_at: number | null;
  }>;

describe("reading a spool's label", () => {
  it("fills in what the label says, marks it, and keeps the photo", async () => {
    const claude = stubClaude();
    const id = await makeSpool({ netGrams: 750 }, true);
    const started = await readLabel(id, { placeholders: ["material", "netGrams"] });
    expect(started.status).toBe(200);
    expect((await started.json<LabelReadResponse>()).spool.labelRead?.status).toBe("reading");

    const spool = await settled(id);
    expect(spool).toMatchObject({
      brand: "Bambu Lab",
      material: "PLA",
      finish: "basic",
      colorName: "Jade White",
      colorHex: "#f4f1ea",
      netGrams: 1000,
      diameterMm: 1.75,
      nozzleTempMin: 190,
      nozzleTempMax: 230,
      bedTempMin: 45,
      bedTempMax: 65,
      dryTempC: 55,
      dryHours: 8,
      productCode: "10100",
      labelRead: null,
    });
    expect(spool.fromLabel).toEqual(
      expect.arrayContaining(["brand", "finish", "colorName", "colorHex", "netGrams", "diameterMm", "productCode"]),
    );
    expect(spool.photo).not.toBeNull();
    // The photo went to Claude as an image; the run is recorded without it.
    expect(JSON.stringify(claude.bodies[0])).toContain('"type":"image"');
    const [row] = await runRows();
    expect(row).toMatchObject({ status: "done", run_outcome: "read" });
    expect(row?.ran_at).not.toBeNull();
    expect(row?.detail).not.toContain("base64");
    expect(JSON.parse(row?.detail ?? "{}")).toMatchObject({ model: "claude-opus-5-5", found: 1 });
    // The change feed told the other person.
    const feed = await env.DB.prepare("SELECT count(*) AS n FROM changes WHERE entity = 'spool' AND entity_id = ?")
      .bind(id)
      .first<{ n: number }>();
    expect(feed?.n).toBeGreaterThanOrEqual(4);
  });

  it("fills what a partly readable label gives and drops values that make no sense", async () => {
    stubClaude({
      spools: [{ ...none, brand: "Polymaker", material: "PETG", nozzleTempMin: 900, dryHours: 8, diameterMm: 17 }],
    });
    const id = await makeSpool();
    await readLabel(id);
    const spool = await settled(id);
    expect(spool).toMatchObject({
      brand: "Polymaker",
      material: "PLA",
      nozzleTempMin: null,
      diameterMm: null,
      dryHours: 8,
      productCode: null,
    });
    expect(spool.fromLabel.sort()).toEqual(["brand", "dryHours"]);
  });

  it("says so quietly when no label can be read, fills nothing, and tries again on request", async () => {
    stubClaude({ spools: [] });
    const id = await makeSpool({ brand: "Eryone" });
    await readLabel(id);
    const spool = await settled(id);
    expect(spool.labelRead).toMatchObject({ status: "unreadable" });
    expect(spool).toMatchObject({ brand: "Eryone", fromLabel: [] });
    expect((await runRows())[0]).toMatchObject({ status: "unreadable", run_outcome: "unreadable" });

    stubClaude({ spools: [jade] });
    await readLabel(id);
    const again = await settled(id);
    expect(again.labelRead).toBeNull();
    expect(again.brand).toBe("Eryone");
    expect(again.colorName).toBe("Jade White");
  });

  it("records why a call failed, and leaves the spool as it is", async () => {
    for (const [answer, outcome] of [
      [{ status: 500 }, "api_error"],
      [{ stopReason: "refusal" }, "refusal"],
      [{ json: { nope: true } }, "bad_shape"],
    ] as const) {
      stubClaude(answer);
      const id = await makeSpool();
      await readLabel(id);
      const spool = await settled(id);
      expect(spool.labelRead?.status).toBe("failed");
      expect(spool.fromLabel).toEqual([]);
      const rows = await runRows();
      expect(rows.some((row) => row.run_outcome === outcome)).toBe(true);
      await env.DB.prepare("DELETE FROM label_reads").run();
    }
  });

  it("never overwrites what a person typed, but may replace the sheet's starting values", async () => {
    stubClaude({ spools: [jade] });
    const id = await makeSpool({ brand: "Sunlu", colorName: "Snow", material: "PETG", netGrams: 500 });
    await readLabel(id, { placeholders: ["netGrams"] });
    const spool = await settled(id);
    expect(spool).toMatchObject({ brand: "Sunlu", colorName: "Snow", material: "PETG", netGrams: 1000 });
    expect(spool.colorHex).toBe("#f4f1ea");
    expect(spool.fromLabel).not.toContain("brand");
    expect(spool.fromLabel).not.toContain("colorName");
    expect(spool.fromLabel).not.toContain("material");
  });

  it("takes a field off 'from the label' once a person edits it, and a read still going leaves it alone", async () => {
    stubClaude({ spools: [jade] });
    const id = await makeSpool();
    await readLabel(id, { placeholders: ["material", "netGrams"] });
    await settled(id);
    const edit = await asPerson(`/api/spools/${id}`, { method: "PATCH", json: { brand: "Mine" } });
    const edited = (await edit.json<SpoolResponse>()).spool;
    expect(edited.brand).toBe("Mine");
    expect(edited.fromLabel).not.toContain("brand");
    expect(edited.fromLabel).toContain("colorName");
    const weight = await asPerson(`/api/spools/${id}/weight`, { method: "PUT", json: { netGrams: 750 } });
    expect((await weight.json<SpoolResponse>()).spool.fromLabel).not.toContain("netGrams");

    // Typed while Claude is still looking: the placeholder is no longer one.
    const slow = await makeSpool({ netGrams: 1000 });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      await gate;
      return Response.json({
        id: "msg",
        type: "message",
        role: "assistant",
        model: "claude-opus-5-5",
        content: [{ type: "text", text: JSON.stringify({ spools: [jade] }) }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      });
    });
    await readLabel(slow, { placeholders: ["netGrams"] });
    await asPerson(`/api/spools/${slow}/weight`, { method: "PUT", json: { netGrams: 250 } });
    release();
    const finished = await settled(slow);
    expect(finished.netGrams).toBe(250);
    expect(finished.fromLabel).not.toContain("netGrams");
  });

  it("makes a spool for each label after a confirmation that lists them", async () => {
    stubClaude({ spools: [jade, petg] });
    const id = await makeSpool();
    await readLabel(id);
    const waiting = await settled(id);
    expect(waiting.labelRead?.status).toBe("multiple");
    expect(waiting.labelRead?.spools).toHaveLength(2);
    // Nothing is made before the tap.
    expect(waiting.brand).toBeNull();
    expect((await (await asPerson("/api/spools")).json<{ spools: Spool[] }>()).spools).toHaveLength(1);

    const accepted = await asPerson(`/api/spools/${id}/label-read/accept`, { method: "POST" });
    expect(accepted.status).toBe(201);
    const body = await accepted.json<LabelReadResponse>();
    expect(body.spool).toMatchObject({ colorName: "Jade White", labelRead: null });
    expect(body.created).toHaveLength(1);
    expect(body.created?.[0]).toMatchObject({ material: "PETG", finish: "HF", colorName: "Black" });
    expect(body.created?.[0]?.photo?.id).not.toBe(body.spool.photo?.id);
    expect(body.created?.[0]?.fromLabel).toEqual(expect.arrayContaining(["brand", "material"]));
    const photo = await asPerson(`/api/photos/${body.created?.[0]?.photo?.id}/thumb`);
    expect(photo.status).toBe(200);
    expect((await (await asPerson("/api/spools")).json<{ spools: Spool[] }>()).spools).toHaveLength(2);
    // A second tap does nothing more.
    expect((await asPerson(`/api/spools/${id}/label-read/accept`, { method: "POST" })).status).toBe(404);
    expect((await (await asPerson("/api/spools")).json<{ spools: Spool[] }>()).spools).toHaveLength(2);
  });

  it("puts a list away with 'not these'", async () => {
    stubClaude({ spools: [jade, petg] });
    const id = await makeSpool();
    await readLabel(id);
    await settled(id);
    const away = await asPerson(`/api/spools/${id}/label-read`, { method: "DELETE" });
    expect((await away.json<LabelReadResponse>()).spool).toMatchObject({ labelRead: null, brand: null });
    expect((await (await asPerson("/api/spools")).json<{ spools: Spool[] }>()).spools).toHaveLength(1);
  });

  it("stops at the day's cap", async () => {
    const claude = stubClaude();
    const now = Date.now();
    const id = await makeSpool();
    for (let i = 0; i < LABEL_READS_PER_DAY; i++) {
      await env.DB.prepare(
        "INSERT INTO label_reads (photo_id, spool_id, status, created_at, ran_at) VALUES (?, ?, 'done', ?, ?)",
      )
        .bind(uuid(), id, now, now)
        .run();
    }
    await readLabel(id);
    const spool = await settled(id);
    expect(spool.labelRead?.status).toBe("cap");
    expect(claude.bodies).toHaveLength(0);
  });

  it("is for people only: no token reads a label, whatever its scopes", async () => {
    const claude = stubClaude();
    const id = await makeSpool();
    const made = await asPerson("/api/agents", {
      method: "POST",
      json: { name: "An agent", scopes: ["read", "capture", "attempts", "printer"] },
    });
    const token = (await made.json<NewTokenResponse>()).token;
    for (const [method, path] of [
      ["POST", `/api/spools/${id}/label-read`],
      ["POST", `/api/spools/${id}/label-read/accept`],
      ["DELETE", `/api/spools/${id}/label-read`],
    ] as const) {
      const response = await request(path, {
        method,
        headers: { Authorization: `Bearer ${token}`, Origin: "http://agent.test" },
      });
      expect(response.status).toBe(403);
    }
    expect(claude.bodies).toHaveLength(0);
  });

  it("is hidden without the key, and needs a photo", async () => {
    stubClaude();
    const bare = { ...env, ANTHROPIC_API_KEY: undefined } as unknown as Env;
    const features = await app.fetch(new Request(`${ORIGIN}/api/features`, { headers: { Cookie: cookie } }), bare);
    expect((await features.json<FeaturesResponse>()).labelReads).toBe(false);
    expect((await (await asPerson("/api/features")).json<FeaturesResponse>()).labelReads).toBe(true);
    const unkeyed = await app.fetch(
      new Request(`${ORIGIN}/api/spools/${uuid()}/label-read`, {
        method: "POST",
        headers: { Cookie: cookie, Origin: ORIGIN, "content-type": "application/json" },
        body: "{}",
      }),
      bare,
    );
    expect(unkeyed.status).toBe(404);
    const noPhoto = await makeSpool({}, false);
    expect((await readLabel(noPhoto)).status).toBe(400);
  });

  it("is picked up by the cron when nobody is working on it, and given up on after two tries", async () => {
    stubClaude({ status: 500 });
    const id = await makeSpool();
    const spool = await getSpool(id);
    await env.DB.prepare(
      "INSERT INTO label_reads (photo_id, spool_id, status, created_at, tries) VALUES (?, ?, 'reading', ?, 2)",
    )
      .bind(spool.photo?.id, id, Date.now() - 10 * STALE_MS)
      .run();
    expect(await resumeLabelReads(env, Date.now())).toBe(1);
    expect((await runRows())[0]).toMatchObject({ status: "failed", run_outcome: "timeout" });
  });
});
