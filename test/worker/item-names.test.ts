import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import TEMPLATE from "../../guest.html?raw";
import type { ItemResponse, ItemsResponse, SearchResponse } from "../../src/shared/api.ts";
import { nameOf } from "../../src/shared/item-name.ts";
import type { ShareResponse } from "../../src/shared/shares.ts";
import { guestRoute } from "../../src/worker/guest/index.tsx";
import { addUser, ORIGIN, request, resetDb, signIn } from "./helpers.ts";

/**
 * An untitled idea pasted from a model page is called by that page's title everywhere (shared/item-name.ts): the
 * Worker hands every screen the title it kept for the link (`Item.linkTitle`), and the shared page says it too.
 */

const LINK = "https://makerworld.com/en/models/1234567-gridfinity-baseplate";
const PAGE_TITLE = "Gridfinity baseplate, 4x4";

const stub = {
  ...env,
  ASSETS: { fetch: async () => new Response(TEMPLATE, { headers: { "Content-Type": "text/html" } }) },
} as unknown as Env;

let cookie = "";

beforeEach(async () => {
  await resetDb();
  await env.DB.prepare("DELETE FROM link_previews").run();
  await addUser("alex", "correct horse", "Alex Rivera", "tomato");
  cookie = await signIn("alex", "correct horse");
});

async function createItem(body: Record<string, unknown>) {
  const response = await request("/api/items", { method: "POST", json: { id: crypto.randomUUID(), ...body }, cookie });
  expect(response.status).toBe(201);
  return (await response.json<ItemResponse>()).item;
}

const keepPreview = (url: string, title: string, failed = 0) =>
  env.DB.prepare("INSERT INTO link_previews (url, title, site, failed, fetched_at) VALUES (?, ?, 'MakerWorld', ?, ?)")
    .bind(url, title, failed, Date.now())
    .run();

describe("an untitled link idea's name", () => {
  it("is its page's title in the item, the list and search, while its own title stays empty", async () => {
    const idea = await createItem({ title: null, note: LINK });
    expect(idea.linkTitle).toBeNull();
    await keepPreview(LINK, PAGE_TITLE);

    const one = (await (await request(`/api/items/${idea.id}`, { cookie })).json<ItemResponse>()).item;
    expect(one.title).toBeNull();
    expect(one.linkTitle).toBe(PAGE_TITLE);
    expect(nameOf(one)).toBe(PAGE_TITLE);

    const list = (await (await request("/api/items?stage=idea", { cookie })).json<ItemsResponse>()).items;
    expect(list.find((item) => item.id === idea.id)?.linkTitle).toBe(PAGE_TITLE);

    const found = await (await request("/api/search?q=gridfinity", { cookie })).json<SearchResponse>();
    const hit = found.ideas.find((h) => h.item.id === idea.id);
    expect(hit?.item.linkTitle).toBe(PAGE_TITLE);
  });

  it("finds a model page's preview under its cleaned address, and leaves out failed reads and titled ideas", async () => {
    const tracked = await createItem({ title: null, note: `${LINK}?from=search#profileId-1` });
    const failed = await createItem({ title: null, note: "https://www.printables.com/model/99-hook" });
    const titled = await createItem({ title: "Desk tidy-up", note: LINK });
    await keepPreview(LINK, PAGE_TITLE);
    await keepPreview("https://www.printables.com/model/99-hook", "Nope", 1);

    const list = (await (await request("/api/items?stage=idea", { cookie })).json<ItemsResponse>()).items;
    const byId = new Map(list.map((item) => [item.id, item]));
    expect(byId.get(tracked.id)?.linkTitle).toBe(PAGE_TITLE);
    expect(byId.get(failed.id)?.linkTitle).toBeNull();
    expect(byId.get(titled.id)?.linkTitle).toBeNull();
  });

  it("is the shared page's title too", async () => {
    const idea = await createItem({ title: null, note: LINK });
    await keepPreview(LINK, PAGE_TITLE);
    const made = await request(`/api/shares/items/${idea.id}`, { method: "PUT", cookie });
    const { token } = (await made.json<ShareResponse>()).share;
    const html = await (await guestRoute(new Request(`${ORIGIN}/s/${token}`), stub)).text();
    expect(html).toContain(`<title>${PAGE_TITLE} · Spaghetti</title>`);
  });
});
