import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import type { ItemResponse, UpkeepResponse } from "../../src/shared/api.ts";
import { addUser, request, resetDb, signIn, uploadPhoto } from "./helpers.ts";

/**
 * Item photos, spool labels and upkeep log photos are stored under one key space (photos/<id>/…) with an id the
 * browser picks: an id that is already another thing's picture is refused, whatever uploads it.
 */
let cookie = "";

beforeEach(async () => {
  await resetDb();
  await addUser("alex", "correct horse", "Alex Rivera", "tomato");
  cookie = await signIn("alex", "correct horse");
});

const picture = (bytes: number[]) => {
  const form = new FormData();
  form.set("width", "10");
  form.set("height", "10");
  form.set("color", "#aabbcc");
  form.set("large", new File([new Uint8Array(bytes)], "l.webp", { type: "image/webp" }));
  form.set("thumb", new File([new Uint8Array(bytes)], "t.webp", { type: "image/webp" }));
  return form;
};
const put = (path: string, bytes: number[]) => request(path, { method: "PUT", body: picture(bytes), cookie });
const stored = async (photoId: string) =>
  Array.from(new Uint8Array((await (await env.PHOTOS.get(`photos/${photoId}/large`))?.arrayBuffer()) ?? []));

async function makeItem() {
  const id = crypto.randomUUID();
  const response = await request("/api/items", { method: "POST", json: { id }, cookie });
  expect(response.status).toBe(201);
  return (await response.json<ItemResponse>()).item.id;
}

async function makeSpool() {
  const id = crypto.randomUUID();
  const response = await request("/api/spools", { method: "POST", json: { id, material: "PLA" }, cookie });
  expect(response.status).toBe(201);
  return id;
}

async function makeLog() {
  const done = await request("/api/printer/upkeep/plate/done", {
    method: "POST",
    json: { id: crypto.randomUUID() },
    cookie,
  });
  expect(done.ok).toBe(true);
  const upkeep = await (await request("/api/printer/upkeep", { cookie })).json<UpkeepResponse>();
  const id = upkeep.tasks.find((task) => task.id === "plate")?.lastDone?.id;
  expect(id).toBeTruthy();
  return id as string;
}

it("refuses an item photo, a spool label or a log photo under an id that is another one's", async () => {
  const [itemId, otherItem, spoolId, logId] = [await makeItem(), await makeItem(), await makeSpool(), await makeLog()];
  const itemPhoto = crypto.randomUUID();
  const label = crypto.randomUUID();
  const logPhoto = crypto.randomUUID();
  expect((await uploadPhoto(itemId, itemPhoto, cookie)).status).toBe(201);
  expect((await put(`/api/spools/${spoolId}/photo/${label}`, [7])).status).toBe(200);
  expect((await put(`/api/printer/upkeep/logs/${logId}/photo/${logPhoto}`, [8])).status).toBe(200);
  const before = { itemPhoto: await stored(itemPhoto), label: await stored(label), logPhoto: await stored(logPhoto) };

  const refused = [
    await put(`/api/spools/${spoolId}/photo/${itemPhoto}`, [9]),
    await put(`/api/spools/${spoolId}/photo/${logPhoto}`, [9]),
    await put(`/api/printer/upkeep/logs/${logId}/photo/${itemPhoto}`, [9]),
    await put(`/api/printer/upkeep/logs/${logId}/photo/${label}`, [9]),
    await uploadPhoto(itemId, label, cookie),
    await uploadPhoto(itemId, logPhoto, cookie),
    await uploadPhoto(otherItem, itemPhoto, cookie),
  ];
  expect(refused.map((response) => response.status)).toEqual([409, 409, 409, 409, 409, 409, 409]);
  // Nothing was overwritten, and each picture is still its owner's.
  expect({ itemPhoto: await stored(itemPhoto), label: await stored(label), logPhoto: await stored(logPhoto) }).toEqual(
    before,
  );

  // Its own id again is a retry, and still works.
  expect((await put(`/api/spools/${spoolId}/photo/${label}`, [7])).status).toBe(200);
  expect((await put(`/api/printer/upkeep/logs/${logId}/photo/${logPhoto}`, [8])).status).toBe(200);
  expect((await uploadPhoto(itemId, itemPhoto, cookie)).ok).toBe(true);
});
