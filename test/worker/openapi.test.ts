import { beforeEach, describe, expect, it } from "vitest";
import type { z } from "zod";
import type { NewTokenResponse } from "../../src/shared/agents.ts";
import {
  Agent,
  Attempt,
  ChangesResponse,
  Item,
  Person,
  Photo,
  Spool,
  Webhook,
} from "../../src/worker/openapi/schemas.ts";
import { addUser, request, resetDb, signIn } from "./helpers.ts";

let cookie: string;
beforeEach(async () => {
  await resetDb();
  await addUser("alex", "correct horse", "Alex Rivera", "tomato");
  cookie = await signIn("alex", "correct horse");
});

const uuid = () => crypto.randomUUID();
const get = async (path: string) => (await request(path, { cookie })).json<Record<string, unknown>>();

async function makeAgent(scopes: string[]) {
  return (await (
    await request("/api/agents", { method: "POST", json: { name: "Claude", scopes }, cookie })
  ).json()) as NewTokenResponse;
}

describe("GET /api/openapi.json", () => {
  it("serves a person the whole document", async () => {
    const response = await request("/api/openapi.json", { cookie });
    expect(response.status).toBe(200);
    const document = await response.json<{
      openapi: string;
      paths: Record<string, unknown>;
      servers: Array<{ url: string }>;
    }>();
    expect(document.openapi).toBe("3.1.0");
    expect(document.servers[0]?.url).toBe("http://spaghetti.test");
    expect(Object.keys(document.paths)).toContain("/api/webhooks");
  });

  it("serves any token, whatever its scopes, and lists only what they allow", async () => {
    const agent = await makeAgent(["capture"]);
    const response = await request("/api/openapi.json", { headers: { Authorization: `Bearer ${agent.token}` } });
    expect(response.status).toBe(200);
    const { paths } = await response.json<{ paths: Record<string, Record<string, unknown>> }>();
    expect(paths["/api/capture"]?.post).toBeDefined();
    expect(paths["/api/items"]?.post).toBeDefined();
    expect(paths["/api/items"]?.get).toBeUndefined();
    expect(paths["/api/agents"]).toBeUndefined();
    expect(paths["/api/webhooks"]).toBeUndefined();
    expect((await request("/api/openapi.json")).status).toBe(401);
  });
});

/** The answers really have the shapes the document says (and no keys it doesn't know). */
describe("the document's schemas match what the API answers", () => {
  const matches = (schema: z.ZodObject, real: unknown) => {
    expect(schema.safeParse(real).success, JSON.stringify(real).slice(0, 300)).toBe(true);
    expect(Object.keys(real as object).sort()).toEqual(Object.keys(schema.shape).sort());
  };

  it("items, attempts, photos, changes, spools, people, agents and webhooks", async () => {
    const itemId = uuid();
    await request("/api/items", { method: "POST", json: { id: itemId, title: "Benchy", stage: "building" }, cookie });
    await request(`/api/items/${itemId}/attempts`, {
      method: "POST",
      json: { id: uuid(), outcome: "success", settings: { layerHeight: 0.2 } },
      cookie,
    });
    await request("/api/spools", { method: "POST", json: { id: uuid(), material: "PLA" }, cookie });
    const agent = await makeAgent(["read"]);
    await request("/api/webhooks", {
      method: "POST",
      json: { url: "https://hooks.example.org/x", kinds: ["all"] },
      cookie,
    });

    const item = ((await get(`/api/items/${itemId}`)).item ?? {}) as Record<string, unknown>;
    matches(Item, item);
    matches(Attempt, (item.attempts as unknown[])[0]);
    matches(Item, ((await get("/api/items")).items as unknown[])[0]);
    expect(Photo.safeParse({}).success).toBe(false);
    matches(ChangesResponse, await get("/api/changes?after=0"));
    matches(Spool, ((await get("/api/spools")).spools as unknown[])[0]);
    matches(Person, ((await get("/api/session")).user ?? {}) as object);
    matches(Agent, ((await get("/api/agents")).agents as unknown[])[0] as object);
    expect(agent.agent.tokens).toHaveLength(1);
    matches(Webhook, ((await get("/api/webhooks")).webhooks as unknown[])[0] as object);
  });
});
