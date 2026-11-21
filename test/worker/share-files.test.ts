import { env } from "cloudflare:workers";
import { strToU8, unzipSync, zipSync } from "fflate";
import { beforeEach, describe, expect, it } from "vitest";
import TEMPLATE from "../../guest.html?raw";
import type { ItemResponse } from "../../src/shared/api.ts";
import type { ShareResponse } from "../../src/shared/shares.ts";
import { DEFAULT_SLICING } from "../../src/shared/slicing/defaults.ts";
import type { FileSlice } from "../../src/shared/slicing/types.ts";
import { guestRoute } from "../../src/worker/guest/index.tsx";
import { addUser, ORIGIN, request, resetDb, signIn } from "./helpers.ts";

/**
 * A shared thing's files (decision 0077): each shows as its card, its plate's picture and the plate's toolpaths come
 * through the link's own token, and nothing more: no other thing's file, no deleted one, no file itself, no download.
 * These tests try to get more out of a link than that.
 */

const stub = {
  ...env,
  ASSETS: { fetch: async () => new Response(TEMPLATE, { headers: { "Content-Type": "text/html" } }) },
} as unknown as Env;

let cookie = "";
const uuid = () => crypto.randomUUID();

beforeEach(async () => {
  await resetDb();
  await addUser("alex", "correct horse", "Alex Rivera", "tomato");
  cookie = await signIn("alex", "correct horse");
});

/** The 3D view's own fetch, as a browser sends it from the page (or its worker). */
const FETCH = { "Sec-Fetch-Mode": "cors", "Sec-Fetch-Dest": "empty", "Sec-Fetch-Site": "same-origin" };

async function guest(path: string, init: RequestInit = {}) {
  const response = await guestRoute(new Request(`${ORIGIN}${path}`, init), stub);
  return { response, html: response.headers.get("Content-Type")?.startsWith("text/html") ? await response.text() : "" };
}

async function createItem(body: Record<string, unknown> = {}) {
  const response = await request("/api/items", { method: "POST", json: { id: uuid(), ...body }, cookie });
  expect(response.status).toBe(201);
  return (await response.json<ItemResponse>()).item;
}

async function share(kind: "items" | "twists", id: string) {
  const response = await request(`/api/shares/${kind}/${id}`, { method: "PUT", cookie });
  expect([200, 201]).toContain(response.status);
  return (await response.json<ShareResponse>()).share;
}

/** A PNG's chunk: length, type, data and a CRC (the reader doesn't check it). */
function chunk(type: string, data: number[]) {
  const length = [24, 16, 8, 0].map((shift) => (data.length >>> shift) & 0xff);
  return [...length, ...Array.from(type, (c) => c.charCodeAt(0)), ...data, 0, 0, 0, 0];
}

/** A whole little PNG; `text` adds a slicer's own text chunk, as a plate picture may carry. */
function png({ text }: { text?: string } = {}) {
  return new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...chunk("IHDR", [0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]),
    ...(text
      ? chunk(
          "tEXt",
          Array.from(`Comment\0${text}`, (c) => c.charCodeAt(0)),
        )
      : []),
    ...chunk("IDAT", [0x78, 0x9c, 0x63, 0, 0, 0, 0, 1]),
    ...chunk("IEND", []),
  ]);
}

const MESH = "<model><mesh>the designer's licensed mesh</mesh></model>";

/** A sliced file as the app keeps it: the plate's G-code beside the model's mesh, as Bambu Studio needs it. */
function slicedFile(plates = [1]) {
  return zipSync({
    "3D/3dmodel.model": strToU8(MESH),
    "Metadata/slice_info.config": strToU8(
      '<config><plate><metadata key="index" value="1"/><object identify_id="7" name="Gift for Alex"/></plate></config>',
    ),
    // A desktop slicer's settings carry a print host's secrets and paths in someone's home folder.
    "Metadata/project_settings.config": strToU8(
      JSON.stringify({
        filament_colour: ["#F4C430"],
        printhost_apikey: "secret-api-key",
        post_process: ["C:\\Users\\someone\\tidy.py"],
      }),
    ),
    "Metadata/plate_1.png": png(),
    ...Object.fromEntries(
      plates.map((n) => [`Metadata/plate_${n}.gcode`, strToU8(`; plate ${n}\nG28\nG1 X10 Y10 Z0.2 E1\n`)]),
    ),
  });
}

const sliceSettings = {
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
} satisfies FileSlice["settings"];

function fileForm(name: string, kind: "model" | "slicer", bytes: Uint8Array, thumb?: Uint8Array) {
  const body = new FormData();
  body.set("name", name);
  body.set("size", String(bytes.length));
  body.set("plate", "1");
  body.set("plateCount", "1");
  body.set("prefill", kind === "slicer" ? JSON.stringify({ estimatedMinutes: 95, weightGrams: 31.5 }) : "{}");
  body.set("kind", kind);
  body.set("file", new File([bytes], name));
  if (thumb) body.set("thumb", new File([thumb], "plate_1.png", { type: "image/png" }));
  return body;
}

/** A model kept with an idea or build, sliced (with a slicer's text in its plate picture, and floating parts). */
async function addModel(itemId: string, name = "fusilli-knob.stl", slice: Partial<FileSlice> = {}) {
  const id = uuid();
  const kept = await request(`/api/items/${itemId}/files/${id}`, {
    method: "PUT",
    body: fileForm(name, "model", strToU8("solid knob\nendsolid knob\n")),
    cookie,
  });
  expect(kept.status).toBe(201);
  const body = new FormData();
  const record: FileSlice = {
    status: "sliced",
    settings: sliceSettings,
    cautions: ["floating"],
    size: [29.96, 11.5, 11.35],
    at: Date.now(),
    ...slice,
  };
  body.set("slice", JSON.stringify(record));
  body.set("sliced", new File([slicedFile()], "x.gcode.3mf"));
  body.set("prefill", JSON.stringify({ estimatedMinutes: 86, weightGrams: 13.2, layerHeight: 0.2 }));
  body.set("thumb", new File([png({ text: "Sliced on Alex's laptop" })], "plate_1.png", { type: "image/png" }));
  const sliced = await request(`/api/files/${id}/sliced`, { method: "PUT", body, cookie });
  expect(sliced.status).toBe(200);
  return id;
}

async function addAttempt(itemId: string) {
  const id = uuid();
  const response = await request(`/api/items/${itemId}/attempts`, { method: "POST", json: { id }, cookie });
  expect(response.status).toBe(201);
  return id;
}

/** A slicer's own .gcode.3mf on an attempt. */
async function addAttemptFile(attemptId: string) {
  const id = uuid();
  const body = fileForm("tugboat.gcode.3mf", "slicer", slicedFile(), png());
  body.set("id", id);
  const response = await request(`/api/attempts/${attemptId}/file`, { method: "PUT", body, cookie });
  expect([200, 201]).toContain(response.status);
  return id;
}

const thumb = (token: string, fileId: string, init: RequestInit = {}) =>
  guest(`/s/${token}/files/${fileId}/thumb`, init);
const toolpaths = (token: string, fileId: string, headers: Record<string, string> = FETCH) =>
  guest(`/s/${token}/files/${fileId}/toolpaths`, { headers });

describe("a shared thing's models", () => {
  it("shows each file as its card, with the plate's 3D view, and never the file itself", async () => {
    const item = await createItem({ title: "Spaghetti merch" });
    const fileId = await addModel(item.id);
    const made = await share("items", item.id);
    const { html } = await guest(`/s/${made.token}`);
    // The card says what the app's says: the print, its size, who sliced it, what with, and its caution.
    for (const words of [
      "The model",
      "fusilli-knob.stl",
      "About 1 h 26 min",
      "13.2 g",
      "29.96 × 11.5 × 11.35 mm",
      "Sliced by Spaghetti",
      "Parts of it float in the air.",
      "No supports",
    ]) {
      expect(html, words).toContain(words);
    }
    // Its picture and toolpaths through the token; no address of the file under /api, nothing to download.
    expect(html).toContain(`/s/${made.token}/files/${fileId}/thumb`);
    expect(html).toContain(`/s/${made.token}/files/${fileId}/toolpaths`);
    expect(html).toContain(`aria-label="See fusilli-knob.stl in 3D"`);
    expect(html).not.toContain("/api/");
    expect(html).not.toMatch(/\bdownload\b/i);
    expect(html).not.toContain("Bambu Studio");
  });

  it("serves the plate's picture without a slicer's text in it", async () => {
    const item = await createItem({ title: "Knob" });
    const fileId = await addModel(item.id);
    const made = await share("items", item.id);
    const { response } = await thumb(made.token, fileId);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Cache-Control")).toBe("private, max-age=300");
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(new TextDecoder().decode(bytes)).not.toContain("Alex");
    expect(new TextDecoder().decode(bytes)).toContain("IEND");
  });

  it("gives the 3D view the plate's toolpaths only: no mesh, no other plate, no picture", async () => {
    const item = await createItem({ title: "Knob" });
    const fileId = await addModel(item.id);
    const made = await share("items", item.id);
    const { response } = await toolpaths(made.token, fileId);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, max-age=300");
    expect(response.headers.get("Content-Disposition")).toBeNull();
    // The browser's copy is the view's fetch's only: a navigation to the address never gets it from the cache.
    expect(response.headers.get("Vary")).toBe("Sec-Fetch-Mode, Sec-Fetch-Dest, Sec-Fetch-Site");
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(Number(response.headers.get("Content-Length"))).toBe(bytes.length);
    expect(Object.keys(unzipSync(bytes)).sort()).toEqual([
      "Metadata/plate_1.gcode",
      "Metadata/project_settings.config",
      "Metadata/slice_info.config",
    ]);
    expect(new TextDecoder().decode(bytes)).not.toContain("licensed mesh");
    // The configs are written anew with only what the view reads: no secrets, paths or objects' names.
    const files = unzipSync(bytes);
    expect(JSON.parse(new TextDecoder().decode(files["Metadata/project_settings.config"]))).toEqual({
      filament_colour: ["#f4c430"],
    });
    for (const secret of ["secret-api-key", "Users", "Alex"])
      expect(new TextDecoder().decode(bytes)).not.toContain(secret);
  });

  it("isn't a file to open or save: a navigation, a download or another site's page gets the 404", async () => {
    const item = await createItem({ title: "Knob" });
    const fileId = await addModel(item.id);
    const made = await share("items", item.id);
    for (const headers of [
      { "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "document", "Sec-Fetch-Site": "none" },
      { "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "empty", "Sec-Fetch-Site": "same-origin" },
      { "Sec-Fetch-Mode": "no-cors", "Sec-Fetch-Dest": "iframe", "Sec-Fetch-Site": "same-origin" },
      { "Sec-Fetch-Mode": "cors", "Sec-Fetch-Dest": "empty", "Sec-Fetch-Site": "cross-site" },
    ]) {
      expect((await toolpaths(made.token, fileId, headers)).response.status, JSON.stringify(headers)).toBe(404);
    }
    // A browser too old to say (and the tests' own fetches) is let through.
    expect((await toolpaths(made.token, fileId, {})).response.status).toBe(200);
  });

  it("opens no other thing's file, a deleted file, or anything once the link is stopped", async () => {
    const shown = await createItem({ title: "Shared" });
    const ownId = await addModel(shown.id);
    const other = await createItem({ title: "Not shared" });
    const otherId = await addModel(other.id);
    // Shared too, with its own link: its file is still not the first link's.
    await share("items", other.id);
    const made = await share("items", shown.id);

    for (const id of [otherId, uuid()]) {
      expect((await thumb(made.token, id)).response.status, id).toBe(404);
      expect((await toolpaths(made.token, id)).response.status, id).toBe(404);
    }
    expect((await guest(`/s/${made.token}`)).html).not.toContain(otherId);
    // Any other part of a file, or the file's own bytes, isn't there at all.
    for (const part of ["file", "sliced", "original-thumb", "previous", "THUMB"]) {
      expect((await guest(`/s/${made.token}/files/${ownId}/${part}`)).response.status, part).toBe(404);
    }

    // Deleted: gone from the page and from the routes; its undo brings it back.
    expect((await request(`/api/items/${shown.id}/files/${ownId}`, { method: "DELETE", cookie })).ok).toBe(true);
    expect((await guest(`/s/${made.token}`)).html).not.toContain(ownId);
    expect((await thumb(made.token, ownId)).response.status).toBe(404);
    expect((await toolpaths(made.token, ownId)).response.status).toBe(404);
    await request(`/api/items/${shown.id}/files/${ownId}/restore`, { method: "POST", cookie });
    expect((await toolpaths(made.token, ownId)).response.status).toBe(200);

    // Stopped: nothing through it at all.
    await request(`/api/shares/${made.id}`, { method: "DELETE", cookie });
    expect((await thumb(made.token, ownId)).response.status).toBe(404);
    expect((await toolpaths(made.token, ownId)).response.status).toBe(404);
  });

  it("shows an attempt's file with its 3D view, and hides it with its attempt", async () => {
    const item = await createItem({ title: "Bath tugboat" });
    const attemptId = await addAttempt(item.id);
    const fileId = await addAttemptFile(attemptId);
    const made = await share("items", item.id);
    const { html } = await guest(`/s/${made.token}`);
    expect(html).toContain("tugboat.gcode.3mf");
    expect(html).toContain(`/s/${made.token}/files/${fileId}/toolpaths`);
    expect((await toolpaths(made.token, fileId)).response.status).toBe(200);
    expect((await thumb(made.token, fileId)).response.status).toBe(200);

    await request(`/api/attempts/${attemptId}`, { method: "DELETE", cookie });
    expect((await guest(`/s/${made.token}`)).html).not.toContain(fileId);
    expect((await toolpaths(made.token, fileId)).response.status).toBe(404);
    expect((await thumb(made.token, fileId)).response.status).toBe(404);
  });

  it("shows a twist's model, and serves it only through the twist's own link", async () => {
    const twistId = uuid();
    await request("/api/twists", { method: "POST", cookie, json: { id: twistId, name: "Knob, 110 %" } });
    const fileId = uuid();
    const kept = await request(`/api/twists/${twistId}/file/${fileId}`, {
      method: "PUT",
      body: fileForm("knob.stl", "model", strToU8("solid knob\nendsolid knob\n")),
      cookie,
    });
    expect(kept.status).toBe(201);
    const body = new FormData();
    body.set("slice", JSON.stringify({ status: "sliced", settings: sliceSettings, at: Date.now() }));
    body.set("sliced", new File([slicedFile()], "x.gcode.3mf"));
    body.set("prefill", JSON.stringify({ estimatedMinutes: 38, weightGrams: 11.3 }));
    expect((await request(`/api/files/${fileId}/sliced`, { method: "PUT", body, cookie })).status).toBe(200);
    const made = await share("twists", twistId);
    expect((await guest(`/s/${made.token}`)).html).toContain("knob.stl");
    expect((await toolpaths(made.token, fileId)).response.status).toBe(200);
    // An idea's link can't reach it.
    const item = await createItem({ title: "Other" });
    const other = await share("items", item.id);
    expect((await toolpaths(other.token, fileId)).response.status).toBe(404);
  });

  it("opens nothing under /api with a link's token", async () => {
    const item = await createItem({ title: "Knob" });
    const fileId = await addModel(item.id);
    const made = await share("items", item.id);
    for (const path of [`/api/files/${fileId}`, `/api/files/${fileId}/sliced`, `/api/files/${fileId}/thumb`]) {
      const asBearer = await request(path, { headers: { Authorization: `Bearer ${made.token}` } });
      expect(asBearer.status, path).toBe(401);
      expect((await request(`${path}?token=${made.token}`)).status, path).toBe(401);
    }
  });

  it("has a policy that lets the page run its own script and fetch only its own files", async () => {
    const item = await createItem({ title: "Knob" });
    await addModel(item.id);
    const made = await share("items", item.id);
    const policy = (await guest(`/s/${made.token}`)).response.headers.get("Content-Security-Policy") ?? "";
    expect(policy).toMatch(/default-src 'none'/);
    expect(policy).toContain(`script-src ${ORIGIN}/assets/guest/;`);
    expect(policy).toContain(`worker-src ${ORIGIN}/assets/guest/;`);
    expect(policy).toContain(`connect-src ${ORIGIN}/s/${made.token}/files/;`);
    expect(policy).not.toMatch(/script-src[^;]*('unsafe-inline'|'unsafe-eval'|'self'|\*)/);
    expect(policy).toMatch(/frame-ancestors 'none'/);
  });
});

describe("escaping a file's words", () => {
  it("keeps a file's name and its settings' words as words, on the card and in what the 3D view is given", async () => {
    const item = await createItem({ title: "Knob" });
    const name = `<img src=x onerror="alert(1)">'&.stl`;
    const id = uuid();
    const kept = await request(`/api/items/${item.id}/files/${id}`, {
      method: "PUT",
      body: fileForm(name, "model", strToU8("solid\nendsolid\n")),
      cookie,
    });
    expect(kept.status).toBe(201);
    const body = new FormData();
    body.set(
      "slice",
      JSON.stringify({
        status: "sliced",
        settings: {
          ...sliceSettings,
          slicing: {
            ...DEFAULT_SLICING,
            filaments: [{ material: "PLA", colorHex: "#f4c430", colorName: `</span><script>alert("c")</script>` }],
          },
        },
        colours: [
          {
            hex: "#f4c430",
            name: `"><svg onload=alert(2)>`,
            share: 100,
            filament: { material: "PLA", colorName: `"><b>` },
            inPantry: false,
          },
        ],
        at: Date.now(),
      }),
    );
    body.set("sliced", new File([slicedFile()], "x.gcode.3mf"));
    body.set("prefill", "{}");
    const sliced = await request(`/api/files/${id}/sliced`, { method: "PUT", body, cookie });
    expect(sliced.status).toBe(200);
    const made = await share("items", item.id);
    const { html } = await guest(`/s/${made.token}`);
    const page = html.slice(html.indexOf("<body"));
    expect(page).not.toContain("<img src=x");
    expect(page).not.toContain("<script>alert");
    expect(page).not.toContain("<svg onload");
    expect(page).not.toMatch(/onerror="alert/);
    expect(page).toContain("&lt;img src=x onerror=");
    // The 3D view's data is one attribute, quoted and escaped: no quote of the words ends it.
    const data = /data-view3d="([^"]*)"/.exec(page)?.[1] ?? "";
    expect(data).toContain("&quot;");
    expect(data).not.toContain("<");
  });
});
