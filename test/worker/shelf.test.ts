import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  type Attempt,
  type AttemptResponse,
  type Item,
  type ItemResponse,
  MAX_SLICER_FILE_BYTES,
  type PrinterResponse,
  type Spool,
  type SpoolAttemptsResponse,
  type SpoolResponse,
  type SpoolsResponse,
} from "../../src/shared/api.ts";
import { DEFAULT_PRINTER } from "../../src/shared/spools.ts";
import { PURGE_AFTER_MS, purgeDeleted } from "../../src/worker/photos.ts";
import { addUser, request, resetDb, signIn } from "./helpers.ts";

let cookie: string;

beforeEach(async () => {
  await resetDb();
  await addUser("alex", "correct horse", "Alex Rivera", "tomato");
  cookie = await signIn("alex", "correct horse");
});

async function addSpool(body: Record<string, unknown> = {}): Promise<Spool> {
  const response = await request("/api/spools", {
    method: "POST",
    cookie,
    json: { id: crypto.randomUUID(), material: "PLA", ...body },
  });
  expect(response.status).toBe(201);
  return (await response.json<SpoolResponse>()).spool;
}

async function spoolList(): Promise<Spool[]> {
  const response = await request("/api/spools", { cookie });
  expect(response.status).toBe(200);
  return (await response.json<SpoolsResponse>()).spools;
}

async function getPrinter(): Promise<PrinterResponse> {
  const response = await request("/api/printer", { cookie });
  expect(response.status).toBe(200);
  return response.json<PrinterResponse>();
}

function load(slot: string, spoolId: string | null) {
  return request(`/api/printer/slots/${slot}`, { method: "PUT", cookie, json: { spoolId } });
}

async function createBuild(): Promise<Item> {
  const response = await request("/api/items", {
    method: "POST",
    cookie,
    json: { id: crypto.randomUUID(), stage: "building", title: "Bracket" },
  });
  return (await response.json<ItemResponse>()).item;
}

async function logAttempt(itemId: string, body: Record<string, unknown> = {}): Promise<Attempt> {
  const response = await request(`/api/items/${itemId}/attempts`, {
    method: "POST",
    cookie,
    json: { id: crypto.randomUUID(), outcome: "success", ...body },
  });
  expect(response.status).toBe(201);
  return (await response.json<AttemptResponse>()).attempt;
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function putFile(
  attemptId: string,
  options: { id?: string; bytes?: Uint8Array | null; size?: number; thumb?: boolean; prefill?: unknown } = {},
  as = cookie,
) {
  const form = new FormData();
  const bytes = options.bytes === undefined ? new Uint8Array([0x50, 0x4b, 3, 4, 9, 9]) : options.bytes;
  form.set("id", options.id ?? crypto.randomUUID());
  form.set("name", "Bracket v2.gcode.3mf");
  form.set("size", String(options.size ?? bytes?.length ?? 0));
  form.set("plate", "2");
  form.set("plateCount", "3");
  form.set("slicer", "BambuStudio 02.01.00.00");
  form.set("prefill", JSON.stringify(options.prefill ?? { layerHeight: 0.2, estimatedMinutes: 90 }));
  if (bytes) form.set("file", new File([bytes], "Bracket v2.gcode.3mf"));
  if (options.thumb !== false) form.set("thumb", new File([PNG], "plate_2.png", { type: "image/png" }));
  return request(`/api/attempts/${attemptId}/file`, { method: "PUT", body: form, cookie: as });
}

describe("spools", () => {
  it("adds, lists, changes, deletes and restores a spool", async () => {
    const spool = await addSpool({
      material: "PLA",
      brand: "Bambu",
      colorName: "Jade white",
      colorHex: "#F4F1EA",
      finish: "matte",
    });
    expect(spool).toMatchObject({
      material: "PLA",
      brand: "Bambu",
      colorHex: "#f4f1ea",
      finish: "matte",
      remaining: "full",
      slot: null,
      photo: null,
    });

    // A retry with the same id gets the same spool back.
    const again = await request("/api/spools", { method: "POST", cookie, json: { id: spool.id, material: "PETG" } });
    expect((await again.json<SpoolResponse>()).spool.material).toBe("PLA");

    const driedAt = Date.now() - 3_600_000;
    const changed = await request(`/api/spools/${spool.id}`, {
      method: "PATCH",
      cookie,
      json: { remaining: "low", driedAt, brand: "  ", note: "Prints best at 215" },
    });
    expect(changed.status).toBe(200);
    expect((await changed.json<SpoolResponse>()).spool).toMatchObject({
      remaining: "low",
      driedAt,
      brand: null,
      note: "Prints best at 215",
    });

    expect((await request(`/api/spools/${spool.id}`, { method: "DELETE", cookie })).status).toBe(204);
    expect(await spoolList()).toEqual([]);
    expect((await request(`/api/spools/${spool.id}`, { cookie })).status).toBe(404);
    expect((await request(`/api/spools/${spool.id}/restore`, { method: "POST", cookie })).status).toBe(200);
    expect((await spoolList()).map((s) => s.id)).toEqual([spool.id]);
  });

  it("refuses what it can't read and needs a session", async () => {
    for (const body of [
      {},
      { material: "" },
      { material: "PLA", remaining: "most" },
      { material: "PLA", colorHex: "red" },
    ]) {
      const response = await request("/api/spools", {
        method: "POST",
        cookie,
        json: { id: crypto.randomUUID(), ...body },
      });
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
    expect((await request("/api/spools")).status).toBe(401);
    expect((await request("/api/printer")).status).toBe(401);
  });

  it("keeps a photo of the label, replacing the old one", async () => {
    const spool = await addSpool();
    const upload = (photoId: string) => {
      const form = new FormData();
      form.set("width", "1200");
      form.set("height", "1600");
      form.set("color", "#806040");
      form.set("large", new File([new Uint8Array([1, 2, 3])], "large", { type: "image/webp" }));
      form.set("thumb", new File([new Uint8Array([4])], "thumb", { type: "image/webp" }));
      return request(`/api/spools/${spool.id}/photo/${photoId}`, { method: "PUT", body: form, cookie });
    };
    const first = crypto.randomUUID();
    const second = crypto.randomUUID();
    expect((await upload(first)).status).toBe(200);
    const response = await upload(second);
    expect((await response.json<SpoolResponse>()).spool.photo).toEqual({
      id: second,
      width: 1200,
      height: 1600,
      color: "#806040",
    });
    expect(await env.PHOTOS.get(`photos/${first}/large`)).toBeNull();
    expect((await request(`/api/photos/${second}/thumb`, { cookie })).status).toBe(200);
  });
});

describe("printer and slots", () => {
  it("starts from the Combo's setup and saves changes", async () => {
    expect(await getPrinter()).toEqual({ setup: DEFAULT_PRINTER, slots: {}, bridge: null });
    const setup = {
      nozzles: { main: { diameter: 0.6, hardened: true }, auxiliary: { diameter: 0.4, hardened: false } },
      plates: ["Textured PEI Plate", "Cool Plate", "Cool Plate"],
      amsUnits: 2,
    };
    const response = await request("/api/printer", { method: "PUT", cookie, json: setup });
    expect(response.status).toBe(200);
    expect((await getPrinter()).setup).toEqual({ ...setup, plates: ["Textured PEI Plate", "Cool Plate"] });
    const bad = await request("/api/printer", { method: "PUT", cookie, json: { ...setup, amsUnits: 9 } });
    expect(bad.status).toBe(400);
  });

  it("saves only the parts it is sent, so two people's edits to different parts both stay", async () => {
    const put = (json: unknown) => request("/api/printer", { method: "PUT", cookie, json });
    // One person changes the AMS units, the other the auxiliary nozzle and the plates, each from a stale copy.
    expect((await put({ amsUnits: 2 })).status).toBe(200);
    expect((await put({ nozzles: { auxiliary: { diameter: 0.6, hardened: false } } })).status).toBe(200);
    const response = await put({ plates: ["Cool Plate"] });
    expect(response.status).toBe(200);
    const expected = {
      nozzles: { main: DEFAULT_PRINTER.nozzles.main, auxiliary: { diameter: 0.6, hardened: false } },
      plates: ["Cool Plate"],
      amsUnits: 2,
    };
    // The answer is the setup as the server now has it, not just what was sent.
    expect((await response.json<PrinterResponse>()).setup).toEqual(expected);
    expect((await getPrinter()).setup).toEqual(expected);
    expect((await put({ nozzles: { main: { diameter: 5, hardened: true } } })).status).toBe(400);
  });

  it("keeps the workspace's slicing defaults, whole, until they are put back to Spaghetti's own", async () => {
    const put = (json: unknown) => request("/api/printer", { method: "PUT", cookie, json });
    const fine = {
      layerHeight: 0.12,
      walls: 3,
      infill: 20,
      pattern: "gyroid",
      supports: "where-needed",
      supportStyle: "tree",
      brim: "auto",
    };
    const saved = await put({ slicing: fine });
    expect(saved.status).toBe(200);
    expect((await saved.json<PrinterResponse>()).setup.slicing).toEqual(fine);
    // Another part of the setup leaves them be.
    await put({ amsUnits: 2 });
    expect((await getPrinter()).setup.slicing).toEqual(fine);
    // Only how a model prints: no filament or plate, and nothing the nozzle can't print.
    expect((await put({ slicing: { ...fine, plate: "Cool Plate" } })).status).toBe(400);
    expect((await put({ slicing: { ...fine, layerHeight: 0.4 } })).status).toBe(400);
    expect((await put({ slicing: { layerHeight: 0.12 } })).status).toBe(400);
    expect((await put({ slicing: null })).status).toBe(200);
    expect((await getPrinter()).setup.slicing).toBeUndefined();
  });

  it("loads a spool into one slot at a time, and empties slots", async () => {
    const white = await addSpool({ colorName: "White" });
    const black = await addSpool({ colorName: "Black" });
    expect((await load("A1", white.id)).status).toBe(200);
    expect((await load("Ext", black.id)).status).toBe(200);
    expect((await getPrinter()).slots).toEqual({ A1: white.id, Ext: black.id });

    // Moving it takes it out of A1; loading over a full slot replaces what was there.
    await load("A3", white.id);
    await load("Ext", white.id);
    expect((await getPrinter()).slots).toEqual({ Ext: white.id });
    expect((await spoolList()).find((s) => s.id === white.id)?.slot).toBe("Ext");

    await load("Ext", null);
    expect((await getPrinter()).slots).toEqual({});

    expect((await load("E1", white.id)).status).toBe(404);
    expect((await load("A5", white.id)).status).toBe(404);
    expect((await load("A2", crypto.randomUUID())).status).toBe(404);
  });

  it("shows a deleted spool's slot as empty, and puts it back on undo", async () => {
    const spool = await addSpool();
    await load("A2", spool.id);
    await request(`/api/spools/${spool.id}`, { method: "DELETE", cookie });
    expect((await getPrinter()).slots).toEqual({});
    await request(`/api/spools/${spool.id}/restore`, { method: "POST", cookie });
    expect((await getPrinter()).slots).toEqual({ A2: spool.id });
  });
});

describe("attempt filaments from the shelf", () => {
  it("keeps the spool on the attempt and lists what was printed with it", async () => {
    const silk = await addSpool({ material: "PLA", finish: "silk", colorName: "Gold", colorHex: "#c9a43b" });
    const other = await addSpool({ material: "PETG" });
    const build = await createBuild();
    const filament = { spoolId: silk.id, type: "PLA", colorName: "Gold", colorHex: "#c9a43b", amsSlot: "A1" };
    const first = await logAttempt(build.id, {
      outcome: "failed",
      printedAt: Date.now() - 120_000,
      settings: { filaments: [filament] },
    });
    expect(first.settings.filaments?.[0]).toEqual(filament);
    // "Same as last time" carries the spool over.
    const second = await logAttempt(build.id, { outcome: "success" });
    expect(second.settings.filaments?.[0]?.spoolId).toBe(silk.id);
    await logAttempt(build.id, { settings: { filaments: [{ spoolId: other.id, type: "PETG" }] } });

    const response = await request(`/api/spools/${silk.id}/attempts`, { cookie });
    expect(response.status).toBe(200);
    const { attempts } = await response.json<SpoolAttemptsResponse>();
    expect(attempts.map((hit) => [hit.attempt.id, hit.number, hit.item.title])).toEqual([
      [second.id, 2, "Bracket"],
      [first.id, 1, "Bracket"],
    ]);

    // Deleted attempts drop out.
    await request(`/api/attempts/${second.id}`, { method: "DELETE", cookie });
    const after = await (await request(`/api/spools/${silk.id}/attempts`, { cookie })).json<SpoolAttemptsResponse>();
    expect(after.attempts.map((hit) => hit.attempt.id)).toEqual([first.id]);

    const bad = await request(`/api/items/${build.id}/attempts`, {
      method: "POST",
      cookie,
      json: { id: crypto.randomUUID(), settings: { filaments: [{ spoolId: "not-a-spool" }] } },
    });
    expect(bad.status).toBe(400);
  });
});

describe("slicer files", () => {
  it("keeps the file with the attempt and serves it to signed-in people", async () => {
    const build = await createBuild();
    const attempt = await logAttempt(build.id);
    const fileId = crypto.randomUUID();
    const response = await putFile(attempt.id, { id: fileId });
    expect(response.status).toBe(201);
    const saved = (await response.json<AttemptResponse>()).attempt;
    expect(saved.file).toMatchObject({
      id: fileId,
      name: "Bracket v2.gcode.3mf",
      size: 6,
      stored: true,
      hasThumb: true,
      plate: 2,
      plateCount: 3,
      slicer: "BambuStudio 02.01.00.00",
      prefill: { layerHeight: 0.2, estimatedMinutes: 90 },
    });

    // It comes with the build, too.
    const item = (await (await request(`/api/items/${build.id}`, { cookie })).json<ItemResponse>()).item;
    expect(item.attempts[0]?.file?.id).toBe(fileId);

    const download = await request(`/api/files/${fileId}`, { cookie });
    expect(download.status).toBe(200);
    expect(download.headers.get("Content-Disposition")).toContain("attachment");
    expect(download.headers.get("Content-Disposition")).toContain("Bracket%20v2.gcode.3mf");
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(new Uint8Array([0x50, 0x4b, 3, 4, 9, 9]));
    const thumb = await request(`/api/files/${fileId}/thumb`, { cookie });
    expect(thumb.headers.get("Content-Type")).toBe("image/png");
    await thumb.arrayBuffer();

    // Never to anyone signed out.
    expect((await request(`/api/files/${fileId}`)).status).toBe(401);
    expect((await request(`/api/files/${fileId}/thumb`)).status).toBe(401);
    expect((await putFile(attempt.id, {}, "")).status).toBe(401);
  });

  it("keeps only what the file said when it is over the cap", async () => {
    const build = await createBuild();
    const attempt = await logAttempt(build.id);
    // The browser sends no bytes for a file over the cap...
    const big = await putFile(attempt.id, { bytes: null, size: MAX_SLICER_FILE_BYTES + 1 });
    expect(big.status).toBe(201);
    const file = (await big.json<AttemptResponse>()).attempt.file;
    expect(file).toMatchObject({ stored: false, hasThumb: true, size: MAX_SLICER_FILE_BYTES + 1 });
    expect((await request(`/api/files/${file?.id}`, { cookie })).status).toBe(404);
    expect((await request(`/api/files/${file?.id}/thumb`, { cookie })).status).toBe(200);

    // ...and the Worker refuses bytes over it.
    const tooBig = await putFile(attempt.id, { bytes: new Uint8Array(MAX_SLICER_FILE_BYTES + 1) });
    expect(tooBig.status).toBe(413);
  });

  it("replaces the attempt's file, removes it with undo, and refuses unknown attempts", async () => {
    const build = await createBuild();
    const attempt = await logAttempt(build.id);
    const first = crypto.randomUUID();
    const second = crypto.randomUUID();
    await putFile(attempt.id, { id: first });
    // A retry of the same upload is harmless.
    expect((await putFile(attempt.id, { id: first })).status).toBe(200);
    await putFile(attempt.id, { id: second });
    expect(await env.PHOTOS.get(`files/${first}/file`)).toBeNull();
    expect((await request(`/api/files/${first}`, { cookie })).status).toBe(404);

    expect((await request(`/api/attempts/${attempt.id}/file`, { method: "DELETE", cookie })).status).toBe(204);
    expect((await request(`/api/files/${second}`, { cookie })).status).toBe(404);
    const restored = await request(`/api/attempts/${attempt.id}/file/restore`, { method: "POST", cookie });
    expect((await restored.json<AttemptResponse>()).attempt.file?.id).toBe(second);

    expect((await putFile(crypto.randomUUID())).status).toBe(404);
    expect((await putFile(attempt.id, { prefill: { layerHeight: "thick" } })).status).toBe(400);
  });

  it("goes with its attempt: hidden when it is deleted, purged with it", async () => {
    const build = await createBuild();
    const kept = await logAttempt(build.id, { printedAt: Date.now() - 60_000 });
    const gone = await logAttempt(build.id);
    const keptFile = crypto.randomUUID();
    const goneFile = crypto.randomUUID();
    await putFile(kept.id, { id: keptFile });
    await putFile(gone.id, { id: goneFile });
    await request(`/api/attempts/${gone.id}`, { method: "DELETE", cookie });
    expect((await request(`/api/files/${goneFile}`, { cookie })).status).toBe(404);

    // A deleted build takes its attempts' files with it.
    const deletedBuild = await createBuild();
    const deletedAttempt = await logAttempt(deletedBuild.id);
    const deletedFile = crypto.randomUUID();
    await putFile(deletedAttempt.id, { id: deletedFile });
    await request(`/api/items/${deletedBuild.id}`, { method: "DELETE", cookie });
    expect((await request(`/api/files/${deletedFile}`, { cookie })).status).toBe(404);

    // And a spool deleted a month ago goes too.
    const spool = await addSpool();
    await request(`/api/spools/${spool.id}`, { method: "DELETE", cookie });

    const result = await purgeDeleted(env, Date.now() + PURGE_AFTER_MS + 1000);
    expect(result).toEqual({ photos: 0, files: 2, spools: 1, attempts: 2, items: 1 });
    expect(await env.PHOTOS.get(`files/${keptFile}/file`)).not.toBeNull();
    for (const id of [goneFile, deletedFile]) {
      expect(await env.PHOTOS.get(`files/${id}/file`)).toBeNull();
      expect(await env.PHOTOS.get(`files/${id}/thumb`)).toBeNull();
    }
    expect((await request(`/api/files/${keptFile}`, { cookie })).status).toBe(200);
  });
});
