import { beforeEach, describe, expect, it } from "vitest";
import type { Spool, SpoolResponse } from "../../src/shared/api.ts";
import { addUser, request, resetDb, signIn } from "./helpers.ts";

let cookie: string;

beforeEach(async () => {
  await resetDb();
  await addUser("alex", "correct horse", "Alex Rivera", "tomato");
  cookie = await signIn("alex", "correct horse");
});

const create = async (body: Record<string, unknown>) =>
  request("/api/spools", { method: "POST", cookie, json: { id: crypto.randomUUID(), material: "PLA", ...body } });
const change = async (id: string, body: Record<string, unknown>) =>
  request(`/api/spools/${id}`, { method: "PATCH", cookie, json: body });
const spoolOf = async (response: Response): Promise<Spool> => (await response.json<SpoolResponse>()).spool;

describe("multi-colour spools", () => {
  it("keeps two or three colours in order and no single colour", async () => {
    const dual = await spoolOf(
      await create({ brand: "Anycubic", finish: "silk", colorHex: "#111111", colors: ["#1A1A1A", "#7B2FBE"] }),
    );
    expect(dual.colors).toEqual(["#1a1a1a", "#7b2fbe"]);
    expect(dual.colorHex).toBeNull();
    const tri = await spoolOf(await create({ colors: ["#1a1a1a", "#d4af37", "#7b2fbe"] }));
    expect(tri.colors).toHaveLength(3);
  });

  it("turns a single colour into a multi-colour one and back", async () => {
    const spool = await spoolOf(await create({ colorHex: "#c8102e" }));
    expect(spool.colors).toBeNull();
    const dual = await spoolOf(await change(spool.id, { colors: ["#f29bc0", "#d4af37"] }));
    expect([dual.colorHex, dual.colors]).toEqual([null, ["#f29bc0", "#d4af37"]]);
    const single = await spoolOf(await change(spool.id, { colorHex: "#f29bc0" }));
    expect([single.colorHex, single.colors]).toEqual(["#f29bc0", null]);
  });

  it("leaves the colours alone when a change says nothing about them, and refuses one colour or four", async () => {
    const spool = await spoolOf(await create({ colors: ["#1a1a1a", "#7b2fbe"] }));
    const renamed = await spoolOf(await change(spool.id, { colorName: "Black/Purple" }));
    expect(renamed.colors).toEqual(["#1a1a1a", "#7b2fbe"]);
    expect((await create({ colors: ["#1a1a1a"] })).status).toBe(400);
    expect((await create({ colors: ["#111111", "#222222", "#333333", "#444444"] })).status).toBe(400);
  });

  it("keeps a product line", async () => {
    const spool = await spoolOf(await create({ brand: "Polymaker", line: " PolyTerra " }));
    expect(spool.line).toBe("PolyTerra");
    expect((await spoolOf(await change(spool.id, { line: "" }))).line).toBeNull();
  });
});
