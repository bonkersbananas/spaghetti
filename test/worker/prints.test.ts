import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { NewTokenResponse } from "../../src/shared/agents.ts";
import type {
  AttemptResponse,
  DeletedResponse,
  Item,
  ItemResponse,
  MoveAttemptResponse,
  PrintSuggestionsResponse,
} from "../../src/shared/api.ts";
import type { ChangesResponse } from "../../src/shared/changes.ts";
import { addUser, request, resetDb, signIn, uploadPhoto } from "./helpers.ts";

let cookie: string;
let token: string;

const uuid = () => crypto.randomUUID();
const asBridge = (path: string, init: RequestInit & { json?: unknown } = {}) =>
  request(path, { ...init, headers: { Authorization: `Bearer ${token}`, Origin: "http://printer.test" } });

beforeEach(async () => {
  await resetDb();
  await addUser("carl", "correct horse", "Carl Oscar", "sea");
  cookie = await signIn("carl", "correct horse");
  const made = await request("/api/agents", {
    method: "POST",
    json: { name: "Printer bridge", scopes: ["read", "attempts", "printer"] },
    cookie,
  });
  token = (await made.json<NewTokenResponse>()).token;
  // The bridge says it is there: its agent is the printer's.
  const told = await asBridge("/api/printer/bridge", { method: "PUT", json: { printerState: "idle", progress: null } });
  expect(told.status).toBe(200);
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A file kept with a build, as the app keeps a model it sliced. */
async function keepFile(itemId: string, name: string, estimatedMinutes = 9) {
  const fileId = uuid();
  const body = new FormData();
  body.set("name", name);
  body.set("size", "4");
  body.set("plate", "1");
  body.set("plateCount", "1");
  body.set("prefill", JSON.stringify({ estimatedMinutes, weightGrams: 1 }));
  body.set("file", new File([new Uint8Array([0x50, 0x4b, 3, 4])], name));
  body.set("thumb", new File([PNG], "plate_1.png", { type: "image/png" }));
  const response = await request(`/api/items/${itemId}/files/${fileId}`, { method: "PUT", body, cookie });
  expect(response.status).toBe(201);
  return fileId;
}

async function build(title: string, stage: "building" | "idea" = "building") {
  const id = uuid();
  const response = await request("/api/items", { method: "POST", cookie, json: { id, title, stage } });
  expect(response.status).toBe(201);
  return id;
}

/** A build started the day before: not one someone is about to print. */
async function startedYesterday(id: string) {
  await env.DB.prepare("UPDATE items SET started_at = ? WHERE id = ?")
    .bind(Date.now() - 26 * 60 * 60_000, id)
    .run();
}

/** "UÖBF glass markers", just started, with the two files Spaghetti sliced for it. */
async function glassMarkers() {
  const id = await build("UÖBF glass markers");
  await keepFile(id, "UOBF-glass-marker.3mf", 50);
  const ring = await keepFile(id, "UOBF-fit-test-ring.3mf", 9);
  return { id, ring };
}

/** What bridge 0.1.3 does for a print: a build named after it, then the attempt in that build. */
async function bridgePrints(name: string, print?: Record<string, unknown>) {
  const ownId = uuid();
  const attemptId = uuid();
  const made = await asBridge("/api/items", { method: "POST", json: { id: ownId, title: name, stage: "building" } });
  expect(made.status).toBe(201);
  const response = await asBridge(`/api/items/${ownId}/attempts`, {
    method: "POST",
    json: { id: attemptId, printedAt: Date.now(), ...(print ? { print } : {}) },
  });
  expect(response.status).toBe(201);
  return { ownId, attemptId, attempt: (await response.json<AttemptResponse>()).attempt };
}

const itemOf = async (id: string) => (await (await request(`/api/items/${id}`, { cookie })).json<ItemResponse>()).item;
const move = (attemptId: string, json: Record<string, unknown>, as: "person" | "bridge" = "person") =>
  as === "person"
    ? request(`/api/attempts/${attemptId}/move`, { method: "POST", cookie, json })
    : asBridge(`/api/attempts/${attemptId}/move`, { method: "POST", json });

describe("a print the bridge files", () => {
  it("goes straight into the build that keeps its file, and the printer's own build goes", async () => {
    const glass = await glassMarkers();
    const { ownId, attemptId, attempt } = await bridgePrints("UOBF-fit-test-ring(2)");

    expect(attempt.itemId).toBe(glass.id);
    expect(attempt.print).toMatchObject({
      name: "UOBF-fit-test-ring(2)",
      placed: "matched",
      asking: false,
      ownItemId: ownId,
      reasons: [{ kind: "file", file: "UOBF-fit-test-ring.3mf" }, { kind: "fresh" }],
    });
    const item = await itemOf(glass.id);
    expect(item.attempts.map((one) => one.id)).toEqual([attemptId]);

    // The printer's build is gone, and isn't something anyone deleted.
    const deleted = await (await request("/api/deleted", { cookie })).json<DeletedResponse>();
    expect(deleted.items.map((one) => one.id)).not.toContain(ownId);
    const builds = await (await request("/api/items?stage=building", { cookie })).json<{ items: Item[] }>();
    expect(builds.items.map((one) => one.id)).toEqual([glass.id]);
  });

  it("still lets bridge 0.1.3 end its print and send its photo through the build it made", async () => {
    const glass = await glassMarkers();
    const { ownId, attemptId } = await bridgePrints("UOBF-fit-test-ring(2)");

    // GET /api/items/<its build> leads to where the print went.
    const followed = await asBridge(`/api/items/${ownId}`, { redirect: "manual" });
    expect(followed.status).toBe(308);
    expect(followed.headers.get("Location")).toBe(`/api/items/${glass.id}`);
    const there = await asBridge(followed.headers.get("Location") ?? "");
    expect((await there.json<ItemResponse>()).item.attempts.map((one) => one.id)).toContain(attemptId);

    const ended = await asBridge(`/api/attempts/${attemptId}`, {
      method: "PATCH",
      json: { endedAt: Date.now(), settings: { actualMinutes: 11 } },
    });
    expect(ended.status).toBe(200);

    const form = new FormData();
    form.set("width", "1920");
    form.set("height", "1080");
    form.set("color", "#a9a095");
    form.set("needsResize", "1");
    form.set("attemptId", attemptId);
    form.set("large", new File([new Uint8Array([0xff, 0xd8, 1])], "frame.jpg", { type: "image/jpeg" }));
    form.set("thumb", new File([new Uint8Array([0xff, 0xd8, 1])], "frame.jpg", { type: "image/jpeg" }));
    const photoId = uuid();
    const sent = await asBridge(`/api/items/${ownId}/photos/${photoId}`, { method: "PUT", body: form });
    expect(sent.status).toBe(201);
    const item = await itemOf(glass.id);
    expect(item.photos.find((photo) => photo.id === photoId)).toMatchObject({ itemId: glass.id, attemptId });

    // A retry of the whole start (the answer to the attempt lost on the way) finds the build it went into, then the
    // same attempt where it is now.
    const remade = await asBridge("/api/items", {
      method: "POST",
      json: { id: ownId, title: "UOBF-fit-test-ring(2)", stage: "building" },
    });
    expect(remade.status).toBe(200);
    expect((await remade.json<ItemResponse>()).item.id).toBe(glass.id);
    const again = await asBridge(`/api/items/${ownId}/attempts`, { method: "POST", json: { id: attemptId } });
    expect(again.status).toBe(201);
    expect((await again.json<AttemptResponse>()).attempt.itemId).toBe(glass.id);
  });

  it("asks which build it is when two builds keep the same file", async () => {
    const glass = await glassMarkers();
    const spare = await build("Spare markers");
    await startedYesterday(spare);
    await keepFile(spare, "UOBF fit test ring.3mf");
    const { ownId, attemptId, attempt } = await bridgePrints("UOBF-fit-test-ring(2)");

    expect(attempt.itemId).toBe(ownId);
    expect(attempt.print).toMatchObject({ placed: "new", asking: true, reasons: [], ownItemId: ownId });
    const { suggestions } = await (
      await request(`/api/attempts/${attemptId}/suggestions`, { cookie })
    ).json<PrintSuggestionsResponse>();
    expect(suggestions.map((one) => one.itemId)).toEqual([glass.id, spare]);
    expect(suggestions[0]?.reasons[0]).toMatchObject({ kind: "file", file: "UOBF-fit-test-ring.3mf" });
  });

  it("starts a build of its own for a print nothing knows, quietly asking", async () => {
    await glassMarkers();
    const { ownId, attempt } = await bridgePrints("cable-clip");
    expect(attempt.itemId).toBe(ownId);
    expect(attempt.print).toMatchObject({ placed: "new", asking: true });
    const { suggestions } = await (
      await request(`/api/attempts/${attempt.id}/suggestions`, { cookie })
    ).json<PrintSuggestionsResponse>();
    expect(suggestions).toEqual([]);
  });

  it("takes a download just before the print as a strong sign, and Open in Bambu Studio too", async () => {
    const bracket = await build("Shelf bracket");
    // Started yesterday: a name alone would only be a suggestion.
    await startedYesterday(bracket);
    const fileId = await keepFile(bracket, "bracket_v2.gcode.3mf", 42);
    expect((await request(`/api/files/${fileId}/downloads`, { method: "POST", cookie })).status).toBe(204);

    const { attempt } = await bridgePrints("bracket_v2");
    expect(attempt.itemId).toBe(bracket);
    expect(attempt.print?.reasons.map((reason) => reason.kind)).toEqual(["file", "sent"]);

    const opened = await request(`/api/files/${fileId}/open-link`, { method: "POST", cookie, json: { part: "file" } });
    expect(opened.status).toBe(200);
    const kept = await env.DB.prepare("SELECT how FROM file_downloads WHERE file_id = ? ORDER BY at")
      .bind(fileId)
      .all();
    expect(kept.results.map((row) => row.how)).toEqual(["download", "studio"]);
  });

  it("uses what a newer bridge says: the estimate and the file's own mark", async () => {
    const glass = await glassMarkers();
    const ring = glass.ring;
    const { attempt } = await bridgePrints("Plate 1", {
      name: "Plate 1",
      gcodeFile: "Metadata/plate_1.gcode",
      fileId: ring,
    });
    expect(attempt.itemId).toBe(glass.id);
    expect(attempt.print?.reasons[0]).toMatchObject({ kind: "marker", file: "UOBF-fit-test-ring.3mf" });
  });

  it("leaves a person's attempts and other agents' alone", async () => {
    const glass = await glassMarkers();
    const own = await build("UOBF-fit-test-ring(2)");
    const response = await request(`/api/items/${own}/attempts`, { method: "POST", cookie, json: { id: uuid() } });
    expect((await response.json<AttemptResponse>()).attempt).toMatchObject({ itemId: own, print: null });
    expect((await itemOf(glass.id)).attempts).toEqual([]);
  });
});

describe("moving an attempt to another build", () => {
  async function asked() {
    const glass = await glassMarkers();
    const spare = await build("Spare markers");
    await startedYesterday(spare);
    await keepFile(spare, "UOBF fit test ring.3mf");
    const printed = await bridgePrints("UOBF-fit-test-ring(2)");
    // A photo of the print, and a note and an outcome from a person.
    expect((await uploadPhoto(printed.ownId, uuid(), cookie, { attemptId: printed.attemptId })).status).toBe(201);
    await request(`/api/attempts/${printed.attemptId}`, {
      method: "PATCH",
      cookie,
      json: { outcome: "partial", note: "Snug fit, a bit tight", failureTags: ["stringing"] },
    });
    return { glass, spare, ...printed };
  }

  it("takes its photos, note, outcome and settings along; the printer's empty build goes with it", async () => {
    const { glass, ownId, attemptId } = await asked();
    // The glass markers have a photo of their own: the print's goes after it.
    await uploadPhoto(glass.id, uuid(), cookie);

    const response = await move(attemptId, { targetId: glass.id });
    expect(response.status).toBe(200);
    const moved = await response.json<MoveAttemptResponse>();
    expect(moved.from).toBeNull();
    expect(moved.to.id).toBe(glass.id);
    expect(moved.attempt).toMatchObject({
      itemId: glass.id,
      outcome: "partial",
      note: "Snug fit, a bit tight",
      failureTags: ["stringing"],
      print: { asking: false, placed: "new", reasons: [] },
      moved: { fromItemId: ownId, fromTitle: "UOBF-fit-test-ring(2)", via: null },
    });
    const photos = moved.to.photos.map((photo) => [photo.attemptId, photo.position]);
    expect(photos).toEqual([
      [null, 0],
      [attemptId, 1],
    ]);
    expect((await request(`/api/items/${ownId}`, { cookie, redirect: "manual" })).status).toBe(308);

    // The feed says what happened: the attempt now in the glass markers, the printer's build gone.
    const feed = await (await request("/api/changes?after=0", { cookie })).json<ChangesResponse>();
    expect(feed.changes.map((change) => [change.entity, change.action, change.itemId])).toEqual(
      expect.arrayContaining([
        ["attempt", "updated", glass.id],
        ["item", "deleted", ownId],
      ]),
    );
  });

  it("is undone in one: the build comes back, the print with it, and it asks again", async () => {
    const { glass, ownId, attemptId } = await asked();
    await move(attemptId, { targetId: glass.id });
    const undone = await request(`/api/attempts/${attemptId}/unmove`, { method: "POST", cookie });
    expect(undone.status).toBe(200);
    const back = await undone.json<MoveAttemptResponse>();
    expect(back.to.id).toBe(ownId);
    expect(back.attempt).toMatchObject({ itemId: ownId, print: { asking: true }, moved: null, outcome: "partial" });
    expect(back.to.photos.map((photo) => [photo.attemptId, photo.position])).toEqual([[attemptId, 0]]);
    expect(back.from?.attempts).toEqual([]);
    // Twice is refused: it isn't where that move put it any more.
    expect((await request(`/api/attempts/${attemptId}/unmove`, { method: "POST", cookie })).status).toBe(409);
  });

  it("brings back the printer's own build for a matched print said to be new", async () => {
    const glass = await glassMarkers();
    const { ownId, attemptId } = await bridgePrints("UOBF-fit-test-ring(2)");
    const response = await move(attemptId, { newBuild: { id: uuid(), title: "UOBF-fit-test-ring(2)" } });
    expect(response.status).toBe(200);
    const moved = await response.json<MoveAttemptResponse>();
    expect(moved.to).toMatchObject({ id: ownId, title: "UOBF-fit-test-ring(2)", stage: "building" });
    expect(moved.from?.id).toBe(glass.id);
    expect(moved.attempt.moved).toMatchObject({ fromItemId: glass.id, fromTitle: "UÖBF glass markers" });

    // And its undo puts it back in the glass markers, the printer's build gone again.
    const undone = await (
      await request(`/api/attempts/${attemptId}/unmove`, { method: "POST", cookie })
    ).json<MoveAttemptResponse>();
    expect(undone.to.id).toBe(glass.id);
    expect((await request(`/api/items/${ownId}`, { cookie, redirect: "manual" })).status).toBe(308);
  });

  it("moves any attempt into a new build, and an idea becomes a build by it (and back with the undo)", async () => {
    const tugboat = await build("Tugboat");
    const attemptId = uuid();
    await request(`/api/items/${tugboat}/attempts`, { method: "POST", cookie, json: { id: attemptId } });
    const idea = await build("Pasta drying rack", "idea");

    const into = await (await move(attemptId, { targetId: idea })).json<MoveAttemptResponse>();
    expect(into.to).toMatchObject({ id: idea, stage: "building" });
    // A person's build stays, even empty.
    expect(into.from).toMatchObject({ id: tugboat, attempts: [] });

    await request(`/api/attempts/${attemptId}/unmove`, { method: "POST", cookie });
    expect((await itemOf(idea)).stage).toBe("idea");

    const fresh = uuid();
    const made = await (
      await move(attemptId, { newBuild: { id: fresh, title: "Tugboat, smaller" } })
    ).json<MoveAttemptResponse>();
    expect(made.to).toMatchObject({ id: fresh, title: "Tugboat, smaller", stage: "building" });
    // Moving it where it is already changes nothing.
    expect((await move(attemptId, { targetId: fresh })).status).toBe(200);
    await request(`/api/attempts/${attemptId}/unmove`, { method: "POST", cookie });
    // The build made for it goes again, into the one it went back to.
    const gone = await request(`/api/items/${fresh}`, { cookie, redirect: "manual" });
    expect(gone.headers.get("Location")).toBe(`/api/items/${tugboat}`);
  });

  it("makes an idea the print started an idea again when it isn't that, and starts it again with the undo", async () => {
    const idea = await build("Planter v2", "idea");
    await keepFile(idea, "planter-v2.gcode.3mf");
    const tugboat = await build("Tugboat");
    const { attemptId, attempt } = await bridgePrints("planter-v2(2)");
    expect(attempt.itemId).toBe(idea);
    expect((await itemOf(idea)).stage).toBe("building");

    // "Not this build?": the idea is an idea again, with its file, and nothing about it lost.
    const moved = await (await move(attemptId, { targetId: tugboat })).json<MoveAttemptResponse>();
    expect(moved.from).toMatchObject({ id: idea, stage: "idea", startedAt: null, attempts: [] });
    expect(moved.from?.files?.map((file) => file.name)).toEqual(["planter-v2.gcode.3mf"]);

    const undone = await (
      await request(`/api/attempts/${attemptId}/unmove`, { method: "POST", cookie })
    ).json<MoveAttemptResponse>();
    expect(undone.to).toMatchObject({ id: idea, stage: "building" });
    expect(undone.to.attempts.map((one) => one.id)).toEqual([attemptId]);
  });

  it("leaves a build the print started as it is when something else was printed in it since", async () => {
    const idea = await build("Planter v2", "idea");
    await keepFile(idea, "planter-v2.gcode.3mf");
    const tugboat = await build("Tugboat");
    const { attemptId } = await bridgePrints("planter-v2(2)");
    await request(`/api/items/${idea}/attempts`, { method: "POST", cookie, json: { id: uuid() } });

    const moved = await (await move(attemptId, { targetId: tugboat })).json<MoveAttemptResponse>();
    expect(moved.from).toMatchObject({ id: idea, stage: "building" });
  });

  it("keeps a build made for the attempt when someone wrote in it since, and undoes the move all the same", async () => {
    const tugboat = await build("Tugboat");
    const attemptId = uuid();
    await request(`/api/items/${tugboat}/attempts`, { method: "POST", cookie, json: { id: attemptId } });
    const fresh = uuid();
    await move(attemptId, { newBuild: { id: fresh, title: "Tugboat, smaller" } });
    await request(`/api/items/${fresh}`, { method: "PATCH", cookie, json: { note: "Scale it to 80 %" } });

    const undone = await (
      await request(`/api/attempts/${attemptId}/unmove`, { method: "POST", cookie })
    ).json<MoveAttemptResponse>();
    expect(undone.to.attempts.map((one) => one.id)).toEqual([attemptId]);
    expect(undone.from).toMatchObject({ id: fresh, note: "Scale it to 80 %", attempts: [] });
    expect((await request(`/api/items/${fresh}`, { cookie, redirect: "manual" })).status).toBe(200);
  });

  it("puts a photo that was still on its way to the old build with the attempt where it is now", async () => {
    const tugboat = await build("Tugboat");
    const smaller = await build("Tugboat, smaller");
    const attemptId = uuid();
    await request(`/api/items/${tugboat}/attempts`, { method: "POST", cookie, json: { id: attemptId } });
    await move(attemptId, { targetId: smaller });
    const photoId = uuid();
    expect((await uploadPhoto(tugboat, photoId, cookie, { attemptId })).status).toBe(201);
    expect((await itemOf(smaller)).photos.map((photo) => photo.id)).toEqual([photoId]);
    expect((await itemOf(tugboat)).photos).toEqual([]);
  });

  it("answers the question with a new build, and asks again with the undo", async () => {
    const { attemptId } = await asked();
    const kept = await request(`/api/attempts/${attemptId}/print`, { method: "PUT", cookie, json: { asking: false } });
    expect((await kept.json<AttemptResponse>()).attempt.print?.asking).toBe(false);
    const again = await request(`/api/attempts/${attemptId}/print`, { method: "PUT", cookie, json: { asking: true } });
    expect((await again.json<AttemptResponse>()).attempt.print?.asking).toBe(true);
  });
});

describe("who may", () => {
  it("lets the bridge's token file its own print and read suggestions, but not move or answer for people", async () => {
    const glass = await glassMarkers();
    const spare = await build("Spare markers");
    await startedYesterday(spare);
    await keepFile(spare, "UOBF fit test ring.3mf");
    const { attemptId } = await bridgePrints("UOBF-fit-test-ring(2)");

    expect((await asBridge(`/api/attempts/${attemptId}/suggestions`)).status).toBe(200);
    expect((await move(attemptId, { targetId: glass.id }, "bridge")).status).toBe(403);
    expect((await asBridge(`/api/attempts/${attemptId}/unmove`, { method: "POST" })).status).toBe(403);
    expect(
      (await asBridge(`/api/attempts/${attemptId}/print`, { method: "PUT", json: { asking: false } })).status,
    ).toBe(403);
    expect((await asBridge(`/api/files/${glass.ring}/downloads`, { method: "POST" })).status).toBe(403);
  });
});
