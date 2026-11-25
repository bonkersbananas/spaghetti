import { env } from "cloudflare:workers";
import { strToU8, zipSync } from "fflate";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hotdogModel } from "../../e2e/fixtures/model-3mf.ts";
import { boxStl } from "../../e2e/fixtures/model-stl.ts";
import type { AgentScope, NewTokenResponse } from "../../src/shared/agents.ts";
import type { AttemptFile, ItemResponse, TwistsResponse } from "../../src/shared/api.ts";
import { addUser, request, resetDb, signIn } from "./helpers.ts";

/** MCP's add_file: models and pictures an agent makes go straight into the app (decision 0078). */

let cookie: string;

beforeEach(async () => {
  await resetDb();
  await addUser("alex", "correct horse", "Alex Rivera", "tomato");
  cookie = await signIn("alex", "correct horse");
});

async function makeAgent(scopes: AgentScope[], name = "Claude for Alex") {
  const response = await request("/api/agents", { method: "POST", json: { name, scopes }, cookie });
  expect(response.status).toBe(201);
  return response.json<NewTokenResponse>();
}

async function callTool(token: string, name: string, args: Record<string, unknown> = {}) {
  const response = await request("/mcp", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json, text/event-stream" },
    json: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } },
  });
  const body = (await response.json()) as { result?: { content?: Array<{ text: string }>; isError?: boolean } };
  return { text: body.result?.content?.[0]?.text ?? "", isError: body.result?.isError === true };
}

const field = (text: string, key: string) => new RegExp(`${key}: ([0-9a-f-]{36})`).exec(text)?.[1] ?? "";
const base64 = (bytes: Uint8Array) => {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};

/** A PNG header with a size, and nothing else: all the Worker reads of one. */
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 3, 0x20, 0, 0, 2, 0x58, 8,
  6, 0, 0, 0,
]);

/** A sliced file in the structure Bambu Studio writes: one plate with its picture, an object and a filament. */
function slicedFile() {
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  return zipSync({
    "[Content_Types].xml": strToU8(`${xml}<Types/>`),
    "3D/3dmodel.model": strToU8(
      `${xml}<model unit="millimeter"><metadata name="Application">BambuStudio-02.01.00.00</metadata><resources/><build/></model>`,
    ),
    "Metadata/model_settings.config": strToU8(
      `${xml}<config><object id="2"><metadata key="name" value="Cable clip"/></object><plate><metadata key="plater_id" value="1"/><metadata key="thumbnail_file" value="Metadata/plate_1.png"/><model_instance><metadata key="object_id" value="2"/><metadata key="identify_id" value="101"/></model_instance></plate></config>`,
    ),
    "Metadata/slice_info.config": strToU8(
      `${xml}<config><header><header_item key="X-BBL-Client-Type" value="slicer"/></header><plate><metadata key="index" value="1"/><metadata key="nozzle_diameters" value="0.4"/><metadata key="prediction" value="4320"/><metadata key="weight" value="18.4"/><object identify_id="101" name="Cable clip" skipped="false"/><filament id="1" type="PLA" color="#00AE42FF" used_m="6.10" used_g="18.40"/></plate></config>`,
    ),
    "Metadata/plate_1.png": PNG,
    "Metadata/plate_1.gcode": strToU8("; HEADER_BLOCK_START\nG28\n"),
  });
}

async function idea(token: string, title = "Bracket") {
  return field((await callTool(token, "capture_idea", { title })).text, "build_id");
}

const itemOf = async (id: string) => (await (await request(`/api/items/${id}`, { cookie })).json<ItemResponse>()).item;

function stubWeb(pages: Record<string, () => Response>) {
  const asked: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname === "cloudflare-dns.com") {
      const type = url.searchParams.get("type");
      return Response.json({ Status: 0, Answer: type === "AAAA" ? [] : [{ type: 1, data: "93.184.216.34" }] });
    }
    asked.push(url.href);
    return pages[url.href]?.() ?? new Response("not found", { status: 404 });
  });
  return { asked };
}

describe("add_file", () => {
  it("keeps an STL with an idea as a model, marked via the agent, waiting for a browser to slice it", async () => {
    const { token, agent } = await makeAgent(["capture"]);
    const buildId = await idea(token);
    const stl = boxStl(40, 20, 10);
    const added = await callTool(token, "add_file", {
      build_id: buildId,
      name: "bracket.stl",
      file_base64: base64(stl),
    });
    expect(added.isError, added.text).toBe(false);
    expect(added.text).toContain("40 × 20 × 10 mm");
    const [file] = (await itemOf(buildId)).files ?? [];
    expect(file).toMatchObject({
      id: field(added.text, "file_id"),
      name: "bracket.stl",
      size: stl.length,
      stored: true,
      kind: "model",
      slice: null,
      hasThumb: false,
      createdVia: agent.id,
    });
    const story = await callTool((await makeAgent(["read"], "Reader")).token, "get_build", { build_id: buildId });
    expect(story.text).toContain("bracket.stl (a model, not sliced yet); added via Claude for Alex");
    const original = await request(`/api/files/${file?.id}`, { cookie });
    expect(new Uint8Array(await original.arrayBuffer())).toEqual(stl);
    const rows = await env.DB.prepare("SELECT actor_kind FROM changes WHERE entity = 'file'").all<{
      actor_kind: string;
    }>();
    expect(rows.results.map((row) => row.actor_kind)).toEqual(["agent"]);
  });

  it("keeps a plain 3MF as a model and reads a sliced one for its plate, settings and picture", async () => {
    const { token, agent } = await makeAgent(["capture"]);
    const buildId = await idea(token);
    expect(
      (await callTool(token, "add_file", { build_id: buildId, name: "hotdog.3mf", file_base64: base64(hotdogModel()) }))
        .isError,
    ).toBe(false);
    const sliced = await callTool(token, "add_file", {
      build_id: buildId,
      name: "clips.gcode.3mf",
      file_base64: base64(slicedFile()),
    });
    expect(sliced.isError, sliced.text).toBe(false);
    const files = (await itemOf(buildId)).files ?? [];
    const [model, slicer] = files as [AttemptFile, AttemptFile];
    expect(model).toMatchObject({ name: "hotdog.3mf", kind: "model", slice: null });
    expect(slicer).toMatchObject({
      name: "clips.gcode.3mf",
      kind: "slicer",
      hasThumb: true,
      plate: 1,
      objects: ["Cable clip"],
      createdVia: agent.id,
    });
    expect(slicer.prefill.estimatedMinutes).toBe(72);
    expect(slicer.slicer).toMatch(/Bambu/);
    expect((await request(`/api/files/${slicer.id}/thumb`, { cookie })).status).toBe(200);
  });

  it("fetches a file_url from the open internet only, and names the file from the address", async () => {
    const { token } = await makeAgent(["capture"]);
    const buildId = await idea(token);
    const stl = boxStl(10);
    const web = stubWeb({ "https://example.com/files/knob.stl": () => new Response(stl) });
    try {
      const ok = await callTool(token, "add_file", {
        build_id: buildId,
        file_url: "https://example.com/files/knob.stl",
      });
      expect(ok.isError, ok.text).toBe(false);
      expect(((await itemOf(buildId)).files ?? [])[0]?.name).toBe("knob.stl");
      for (const url of [
        "http://example.com/files/knob.stl",
        "https://127.0.0.1/knob.stl",
        "https://example.com:8443/k.stl",
      ]) {
        expect((await callTool(token, "add_file", { build_id: buildId, file_url: url })).isError, url).toBe(true);
      }
      // No name in the address, none given.
      const nameless = await callTool(token, "add_file", {
        build_id: buildId,
        file_url: "https://example.com/download?id=3",
      });
      expect(nameless.text).toContain("name");
      expect(web.asked).toEqual(["https://example.com/files/knob.stl"]);
      // Over the cap: refused by its size or while it is read.
      const huge = stubWeb({
        "https://example.com/big.stl": () =>
          new Response("x", { headers: { "content-length": String(26 * 1024 * 1024) } }),
      });
      const refused = await callTool(token, "add_file", { build_id: buildId, file_url: "https://example.com/big.stl" });
      expect(refused.text).toContain("too large");
      expect(huge.asked).toHaveLength(1);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("refuses what isn't a model file: too big, a wrong type, a wrong name, nothing", async () => {
    const { token } = await makeAgent(["capture"]);
    const buildId = await idea(token);
    const send = (args: Record<string, unknown>) => callTool(token, "add_file", { build_id: buildId, ...args });
    expect((await send({ name: "big.stl", file_base64: "A".repeat(14 * 1024 * 1024) })).text).toContain("too large");
    expect((await send({ name: "model.obj", file_base64: base64(boxStl(5)) })).text).toContain(".stl or .3mf");
    expect((await send({ name: "fake.stl", file_base64: base64(PNG) })).text).toContain("isn't an STL");
    expect((await send({ name: "fake.3mf", file_base64: base64(boxStl(5)) })).text).toContain("isn't a 3MF");
    expect((await send({ name: "a.stl", file_base64: "!!!" })).isError).toBe(true);
    expect((await send({ name: "a.stl" })).text).toContain("file_url or file_base64");
    expect((await callTool(token, "add_file", { name: "a.stl", file_base64: base64(boxStl(5)) })).text).toContain(
      "exactly one",
    );
    expect((await itemOf(buildId)).files ?? []).toHaveLength(0);
  });

  it("refuses a 3MF that would unpack to more than the Worker may hold, without reading it", async () => {
    const { token } = await makeAgent(["capture"]);
    const buildId = await idea(token);
    // Sixty pictures each just under their own 4 MB limit: a quarter of a megabyte as a file, 240 MB unpacked.
    const entries: Record<string, Uint8Array> = { "Metadata/slice_info.config": strToU8("<config/>") };
    for (let n = 1; n <= 60; n++) entries[`Metadata/plate_${n}.png`] = new Uint8Array(4 * 1024 * 1024 - 1);
    const bomb = zipSync(entries, { level: 1 });
    expect(bomb.length).toBeLessThan(1024 * 1024);
    const refused = await callTool(token, "add_file", {
      build_id: buildId,
      name: "bomb.3mf",
      file_base64: base64(bomb),
    });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("more than Spaghetti can read");
    expect((await itemOf(buildId)).files ?? []).toHaveLength(0);
  });

  it("keeps an attempt's slicer file, replacing the one it had, with the attempts scope", async () => {
    const { token, agent } = await makeAgent(["capture", "attempts"]);
    const buildId = await idea(token);
    const attempt = field(
      (await callTool(token, "log_attempt", { build_id: buildId, outcome: "success" })).text,
      "attempt_id",
    );
    const first = await callTool(token, "add_file", {
      attempt_id: attempt,
      name: "clips.gcode.3mf",
      file_base64: base64(slicedFile()),
    });
    expect(first.isError, first.text).toBe(false);
    const second = await callTool(token, "add_file", {
      attempt_id: attempt,
      name: "bracket.stl",
      file_base64: base64(boxStl(10)),
    });
    expect(second.isError, second.text).toBe(false);
    const { attempts } = await itemOf(buildId);
    expect(attempts[0]?.file).toMatchObject({ name: "bracket.stl", kind: "model", createdVia: agent.id });
    const capture = await makeAgent(["capture"], "capturer");
    const refused = await callTool(capture.token, "add_file", {
      attempt_id: attempt,
      name: "a.stl",
      file_base64: base64(boxStl(5)),
    });
    expect(refused).toEqual({ text: 'This token needs the "attempts" scope for that.', isError: true });
  });

  it("keeps a twist's model with the capture scope, and refuses a sliced file for a twist", async () => {
    const { token, agent } = await makeAgent(["capture", "read"]);
    const made = await callTool(token, "add_twist", { name: "Fusilli knob" });
    const twistId = field(made.text, "twist_id");
    const added = await callTool(token, "add_file", {
      twist_id: twistId,
      name: "knob.stl",
      file_base64: base64(boxStl(12)),
    });
    expect(added.isError, added.text).toBe(false);
    const { twists } = await (await request("/api/twists", { cookie })).json<TwistsResponse>();
    expect(twists[0]?.model).toMatchObject({ name: "knob.stl", kind: "model", createdVia: agent.id });
    const sliced = await callTool(token, "add_file", {
      twist_id: twistId,
      name: "clips.gcode.3mf",
      file_base64: base64(slicedFile()),
    });
    expect(sliced.text).toContain("twist keeps a model");
    const attemptsOnly = await makeAgent(["attempts"], "attempter");
    const refused = await callTool(attemptsOnly.token, "add_file", {
      twist_id: twistId,
      name: "k.stl",
      file_base64: base64(boxStl(5)),
    });
    expect(refused.isError).toBe(true);
  });

  it("refuses a token without the scope before anything is fetched", async () => {
    const owner = await makeAgent(["capture"]);
    const buildId = await idea(owner.token);
    const web = stubWeb({ "https://example.com/knob.stl": () => new Response(boxStl(5)) });
    try {
      const reader = await makeAgent(["read"], "reader");
      const refused = await callTool(reader.token, "add_file", {
        build_id: buildId,
        file_url: "https://example.com/knob.stl",
      });
      expect(refused.text).toContain("needs the");
      const gone = await callTool(owner.token, "add_file", {
        build_id: crypto.randomUUID(),
        file_base64: base64(boxStl(5)),
        name: "a.stl",
      });
      expect(gone.isError).toBe(true);
      expect(web.asked).toEqual([]);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("add_photo takes a PNG render, kept as it is until a browser makes the copies", async () => {
    const { token } = await makeAgent(["capture"]);
    const buildId = await idea(token);
    const added = await callTool(token, "add_photo", { build_id: buildId, photo_base64: base64(PNG) });
    expect(added.isError, added.text).toBe(false);
    const [photo] = (await itemOf(buildId)).photos;
    expect(photo).toMatchObject({ width: 800, height: 600, needsResize: true });
    expect((await request(`/api/photos/${photo?.id}/large`, { cookie })).headers.get("content-type")).toBe("image/png");
    // Elsewhere a PNG is still refused.
    const form = new FormData();
    form.set("width", "800");
    form.set("height", "600");
    form.set("color", "#a9a095");
    form.set("large", new File([PNG], "p", { type: "image/png" }));
    form.set("thumb", new File([PNG], "p", { type: "image/png" }));
    const plain = await request(`/api/items/${buildId}/photos/${crypto.randomUUID()}`, {
      method: "PUT",
      body: form,
      cookie,
    });
    expect(plain.status).toBe(415);
  });
});

describe("files from agents and the people's own", () => {
  const SETTINGS = {
    machine: "Bambu Lab X2D 0.4 nozzle",
    process: "0.20mm Standard @BBL X2D",
    filaments: ["Bambu PLA Basic @BBL X2D 0.4 nozzle"],
    layerHeight: 0.2,
    materials: ["PLA"],
    bedType: "Textured PEI Plate",
    supports: false,
    scale: 100,
    engine: "1",
    orca: "2.5.0-dev",
  };
  const slicedBody = (status: "sliced" | "failed", extra: Record<string, string> = {}) => {
    const body = new FormData();
    body.set(
      "slice",
      JSON.stringify(
        status === "sliced"
          ? { status, settings: SETTINGS, at: 1 }
          : { status, settings: SETTINGS, problem: "engine", at: 2 },
      ),
    );
    if (status === "sliced") {
      body.set("sliced", new File([new Uint8Array([0x50, 0x4b, 3, 4])], "x.gcode.3mf"));
      body.set("prefill", JSON.stringify({ estimatedMinutes: 38, weightGrams: 11.3 }));
    }
    for (const [key, value] of Object.entries(extra)) body.set(key, value);
    return body;
  };

  /** A person's own file on an attempt, put there the way the app does. */
  async function personsFile(attemptId: string, name = "mine.stl") {
    const body = new FormData();
    const bytes = boxStl(5);
    body.set("id", crypto.randomUUID());
    body.set("name", name);
    body.set("size", String(bytes.length));
    body.set("plate", "1");
    body.set("plateCount", "1");
    body.set("prefill", "{}");
    body.set("kind", "model");
    body.set("file", new File([bytes], name));
    const response = await request(`/api/attempts/${attemptId}/file`, { method: "PUT", body, cookie });
    expect(response.status).toBe(201);
  }

  it("never replaces a file a person added to an attempt or a twist", async () => {
    const { token } = await makeAgent(["capture", "attempts", "read"]);
    const buildId = await idea(token);
    const attempt = field(
      (await callTool(token, "log_attempt", { build_id: buildId, outcome: "success" })).text,
      "attempt_id",
    );
    await personsFile(attempt);
    const refused = await callTool(token, "add_file", {
      attempt_id: attempt,
      name: "x.stl",
      file_base64: base64(boxStl(6)),
    });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("A person added the file");
    expect((await itemOf(buildId)).attempts[0]?.file?.name).toBe("mine.stl");
    // A twist's model a person made.
    const twistId = field((await callTool(token, "add_twist", { name: "Knob" })).text, "twist_id");
    const theirs = new FormData();
    theirs.set("name", "knob.stl");
    theirs.set("size", String(boxStl(5).length));
    theirs.set("plate", "1");
    theirs.set("plateCount", "1");
    theirs.set("prefill", "{}");
    theirs.set("kind", "model");
    theirs.set("file", new File([boxStl(5)], "knob.stl"));
    expect(
      (await request(`/api/twists/${twistId}/file/${crypto.randomUUID()}`, { method: "PUT", body: theirs, cookie }))
        .status,
    ).toBe(201);
    const twistRefused = await callTool(token, "add_file", {
      twist_id: twistId,
      name: "k2.stl",
      file_base64: base64(boxStl(7)),
    });
    expect(twistRefused.text).toContain("A person added the file");
    const { twists } = await (await request("/api/twists", { cookie })).json<TwistsResponse>();
    expect(twists[0]?.model?.name).toBe("knob.stl");
  });

  it("refuses an agent that sends a person's file again under its own id", async () => {
    const { token } = await makeAgent(["capture", "attempts"]);
    const auth = { Authorization: `Bearer ${token}` };
    const buildId = await idea(token);
    const form = (id: string, bytes = boxStl(5)) => {
      const body = new FormData();
      body.set("id", id);
      body.set("name", "mine.stl");
      body.set("size", String(bytes.length));
      body.set("plate", "1");
      body.set("plateCount", "1");
      body.set("prefill", "{}");
      body.set("kind", "model");
      body.set("file", new File([bytes], "mine.stl"));
      return body;
    };
    const itemFile = crypto.randomUUID();
    expect(
      (await request(`/api/items/${buildId}/files/${itemFile}`, { method: "PUT", body: form(itemFile), cookie }))
        .status,
    ).toBe(201);
    expect(
      (
        await request(`/api/items/${buildId}/files/${itemFile}`, {
          method: "PUT",
          body: form(itemFile, boxStl(9)),
          headers: auth,
        })
      ).status,
    ).toBe(409);
    const attempt = field(
      (await callTool(token, "log_attempt", { build_id: buildId, outcome: "success" })).text,
      "attempt_id",
    );
    const attemptFile = crypto.randomUUID();
    expect(
      (await request(`/api/attempts/${attempt}/file`, { method: "PUT", body: form(attemptFile), cookie })).status,
    ).toBe(201);
    expect(
      (
        await request(`/api/attempts/${attempt}/file`, {
          method: "PUT",
          body: form(attemptFile, boxStl(9)),
          headers: auth,
        })
      ).status,
    ).toBe(409);
    const twistId = field((await callTool(token, "add_twist", { name: "Knob" })).text, "twist_id");
    const twistFile = crypto.randomUUID();
    expect(
      (await request(`/api/twists/${twistId}/file/${twistFile}`, { method: "PUT", body: form(twistFile), cookie }))
        .status,
    ).toBe(201);
    expect(
      (
        await request(`/api/twists/${twistId}/file/${twistFile}`, {
          method: "PUT",
          body: form(twistFile, boxStl(9)),
          headers: auth,
        })
      ).status,
    ).toBe(409);
    for (const id of [itemFile, attemptFile, twistFile]) {
      expect(new Uint8Array(await (await request(`/api/files/${id}`, { cookie })).arrayBuffer())).toEqual(boxStl(5));
    }
  });

  it("fills an attempt's empty fields from an agent's file, never what was typed", async () => {
    const { token } = await makeAgent(["capture", "attempts"]);
    const buildId = await idea(token);
    const attempt = field(
      (
        await callTool(token, "log_attempt", {
          build_id: buildId,
          outcome: "success",
          settings: { estimatedMinutes: 10 },
        })
      ).text,
      "attempt_id",
    );
    expect(
      (
        await callTool(token, "add_file", {
          attempt_id: attempt,
          name: "clips.gcode.3mf",
          file_base64: base64(slicedFile()),
        })
      ).isError,
    ).toBe(false);
    const settings = (await itemOf(buildId)).attempts[0]?.settings;
    expect(settings).toMatchObject({ estimatedMinutes: 10, weightGrams: 18.4 });
    expect(settings?.filaments?.[0]?.type).toBe("PLA");
  });

  it("fills the attempt from the slice the browser makes of an agent's model, and a failure never replaces a good slice", async () => {
    const { token } = await makeAgent(["capture", "attempts"]);
    const buildId = await idea(token);
    const attempt = field(
      (await callTool(token, "log_attempt", { build_id: buildId, outcome: "success", settings: { weightGrams: 5 } }))
        .text,
      "attempt_id",
    );
    const added = await callTool(token, "add_file", {
      attempt_id: attempt,
      name: "cube.stl",
      file_base64: base64(boxStl(10)),
    });
    const fileId = field(added.text, "file_id");
    // One device claims it; another doesn't. A person's own model is nobody's to claim here.
    expect(
      (
        await (
          await request(`/api/files/${fileId}/read-claim`, { method: "POST", cookie })
        ).json<{ claimed: boolean }>()
      ).claimed,
    ).toBe(true);
    expect(
      (
        await (
          await request(`/api/files/${fileId}/read-claim`, { method: "POST", cookie })
        ).json<{ claimed: boolean }>()
      ).claimed,
    ).toBe(false);
    expect(
      (
        await request(`/api/files/${fileId}/read-claim`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        })
      ).status,
    ).toBe(403);
    expect(
      (await request(`/api/files/${fileId}/sliced`, { method: "PUT", body: slicedBody("sliced"), cookie })).status,
    ).toBe(200);
    expect((await itemOf(buildId)).attempts[0]?.settings).toMatchObject({ weightGrams: 5, estimatedMinutes: 38 });
    // Sliced: nothing to claim any more, and another device's failure leaves the good slice be.
    expect(
      (
        await (
          await request(`/api/files/${fileId}/read-claim`, { method: "POST", cookie })
        ).json<{ claimed: boolean }>()
      ).claimed,
    ).toBe(false);
    const failed = await request(`/api/files/${fileId}/sliced`, {
      method: "PUT",
      body: slicedBody("failed", { quiet: "1" }),
      cookie,
    });
    expect(failed.status).toBe(200);
    expect((await itemOf(buildId)).attempts[0]?.file?.slice?.status).toBe("sliced");
    // A re-slice someone asked for keeps the slice it replaces for the undo, and may fail.
    const again = await request(`/api/files/${fileId}/sliced`, {
      method: "PUT",
      body: slicedBody("failed", { keep: "previous" }),
      cookie,
    });
    expect(again.status).toBe(200);
    expect((await itemOf(buildId)).attempts[0]?.file?.slice?.status).toBe("failed");
  });

  it("refuses a file id that belongs to another file, on every upload route", async () => {
    const { token } = await makeAgent(["capture", "attempts"]);
    const buildId = await idea(token);
    const other = await idea(token, "Other");
    const attempt = field(
      (await callTool(token, "log_attempt", { build_id: other, outcome: "success" })).text,
      "attempt_id",
    );
    const twistId = field((await callTool(token, "add_twist", { name: "Knob" })).text, "twist_id");
    const itemFile = field(
      (await callTool(token, "add_file", { build_id: buildId, name: "a.stl", file_base64: base64(boxStl(5)) })).text,
      "file_id",
    );
    const form = (name = "b.stl") => {
      const body = new FormData();
      body.set("name", name);
      body.set("size", String(boxStl(6).length));
      body.set("plate", "1");
      body.set("plateCount", "1");
      body.set("prefill", "{}");
      body.set("kind", "model");
      body.set("file", new File([boxStl(6)], name));
      return body;
    };
    const auth = { Authorization: `Bearer ${token}` };
    // The item file's id, offered to a twist, to another item and, as an attempt's file, to an attempt.
    expect(
      (await request(`/api/twists/${twistId}/file/${itemFile}`, { method: "PUT", body: form(), headers: auth })).status,
    ).toBe(409);
    expect(
      (await request(`/api/items/${other}/files/${itemFile}`, { method: "PUT", body: form(), headers: auth })).status,
    ).toBe(409);
    const asAttempt = form();
    asAttempt.set("id", itemFile);
    expect(
      (await request(`/api/attempts/${attempt}/file`, { method: "PUT", body: asAttempt, headers: auth })).status,
    ).toBe(409);
    const start = await request("/api/uploads", {
      method: "POST",
      headers: auth,
      json: { id: itemFile, part: "file", kind: "model", name: "c.stl", size: 10 },
    });
    expect(start.status).toBe(409);
    // Its bytes are the ones it was given.
    expect(new Uint8Array(await (await request(`/api/files/${itemFile}`, { cookie })).arrayBuffer())).toEqual(
      boxStl(5),
    );
  });
});
