import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { PrinterResponse } from "../../src/shared/api.ts";
import type { PairingResponse, PairResponse } from "../../src/shared/bridge.ts";
import { addUser, request, resetDb, signIn } from "./helpers.ts";

let cookie: string;

beforeEach(async () => {
  await resetDb();
  await env.DB.prepare("DELETE FROM bridge_pairings").run();
  await env.DB.prepare("DELETE FROM bridge").run();
  await env.DB.prepare("DELETE FROM auth_hits").run();
  await addUser("alex", "correct horse", "Alex Rivera", "tomato");
  cookie = await signIn("alex", "correct horse");
});

const makeCode = async () => {
  const response = await request("/api/bridge/pairing", { method: "POST", cookie });
  expect(response.status).toBe(201);
  return response.json<PairingResponse>();
};
const exchange = (code: string, ip = "203.0.113.7") =>
  request("/api/bridge/pair", { method: "POST", json: { code }, headers: { "cf-connecting-ip": ip } });
const asToken = (token: string, path: string, init: RequestInit & { json?: unknown } = {}) =>
  request(path, { ...init, headers: { Authorization: `Bearer ${token}` } });

describe("pairing the printer bridge", () => {
  it("makes a short code that lasts about ten minutes and is stored only as a hash", async () => {
    const made = await makeCode();
    expect(made.code).toMatch(/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
    expect(made.expiresAt - Date.now()).toBeGreaterThan(9 * 60_000);
    expect(made.expiresAt - Date.now()).toBeLessThanOrEqual(10 * 60_000);
    const rows = await env.DB.prepare("SELECT code_hash FROM bridge_pairings").all<{ code_hash: string }>();
    expect(rows.results).toHaveLength(1);
    expect(JSON.stringify(rows.results)).not.toContain(made.code.replace("-", ""));
  });

  it("needs a signed-in person to make a code", async () => {
    expect((await request("/api/bridge/pairing", { method: "POST" })).status).toBe(401);
  });

  it("exchanges the code once for a token with exactly read, attempts and printer", async () => {
    const { code } = await makeCode();
    const first = await exchange(code);
    expect(first.status).toBe(200);
    const paired = await first.json<PairResponse>();
    expect(paired.token).toMatch(/^spg_/);
    expect(paired.scopes).toEqual(["read", "attempts", "printer"]);
    expect(paired.appUrl).toBe("http://spaghetti.test");
    // Spent: the same code, in any spelling, is gone.
    const second = await exchange(code.toLowerCase().replace("-", ""));
    expect(second.status).toBe(410);
    expect((await second.json<{ error: { code: string } }>()).error.code).toBe("code_gone");
    // The token works for what the bridge does, and not for a capture or for people's things.
    expect((await asToken(paired.token, "/api/printer")).status).toBe(200);
    expect(
      (await asToken(paired.token, "/api/printer/bridge", { method: "PUT", json: { printerState: "idle" } })).status,
    ).toBe(200);
    expect((await asToken(paired.token, "/api/capture", { method: "POST", json: { text: "x" } })).status).toBe(403);
    expect((await asToken(paired.token, "/api/agents")).status).toBe(403);
    // It acts for the person who made the code, as "Printer bridge".
    const agent = await env.DB.prepare("SELECT name, owner_id FROM agents WHERE id = ?")
      .bind(paired.agentId)
      .first<{ name: string; owner_id: string }>();
    expect(agent?.name).toBe("Printer bridge");
  });

  it("is single use even when two installers race", async () => {
    const { code } = await makeCode();
    const results = await Promise.all([exchange(code, "198.51.100.1"), exchange(code, "198.51.100.2")]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 410]);
  });

  it("refuses an expired code, a wrong code and nonsense", async () => {
    const { code } = await makeCode();
    await env.DB.prepare("UPDATE bridge_pairings SET expires_at = ?")
      .bind(Date.now() - 1000)
      .run();
    expect((await exchange(code)).status).toBe(410);
    expect((await exchange("AAAA-AAAA")).status).toBe(410);
    expect((await exchange("x")).status).toBe(410);
    expect((await request("/api/bridge/pair", { method: "POST", json: {} })).status).toBe(410);
  });

  it("lets only the newest code work", async () => {
    const old = await makeCode();
    const fresh = await makeCode();
    expect((await exchange(old.code)).status).toBe(410);
    expect((await exchange(fresh.code)).status).toBe(200);
  });

  it("limits tries: ten an address in ten minutes, however right the code is", async () => {
    const { code } = await makeCode();
    for (let i = 0; i < 10; i++) expect((await exchange("BBBB-BBBB", "192.0.2.9")).status).toBe(410);
    const slowed = await exchange(code, "192.0.2.9");
    expect(slowed.status).toBe(429);
    expect((await slowed.json<{ error: { code: string } }>()).error.code).toBe("rate_limited");
    // Another address is not slowed, and the code was never spent by the refused try.
    expect((await exchange(code, "192.0.2.10")).status).toBe(200);
  });

  it("limits how many codes a person can make", async () => {
    for (let i = 0; i < 6; i++) await makeCode();
    expect((await request("/api/bridge/pairing", { method: "POST", cookie })).status).toBe(429);
  });

  it("pairing again replaces the bridge: the same agent, the old token ended", async () => {
    const first = await (await exchange((await makeCode()).code)).json<PairResponse>();
    const second = await (await exchange((await makeCode()).code, "203.0.113.8")).json<PairResponse>();
    expect(second.agentId).toBe(first.agentId);
    expect((await asToken(first.token, "/api/printer")).status).toBe(401);
    expect((await asToken(second.token, "/api/printer")).status).toBe(200);
  });

  it("disconnecting ends the token and forgets the bridge", async () => {
    const paired = await (await exchange((await makeCode()).code)).json<PairResponse>();
    await asToken(paired.token, "/api/printer/bridge", {
      method: "PUT",
      json: { printerState: "idle", version: "1.0.0" },
    });
    const before = await (await request("/api/printer", { cookie })).json<PrinterResponse>();
    expect(before.bridge?.version).toBe("1.0.0");
    // The page can tell when it paired, so a bridge already running isn't taken for the new one.
    expect(before.bridge?.pairedAt).toBeGreaterThan(Date.now() - 60_000);
    expect(before.bridge?.lastSeenAt).toBeGreaterThanOrEqual(before.bridge?.pairedAt ?? Infinity);
    const gone = await request("/api/printer/bridge", { method: "DELETE", cookie });
    expect(gone.status).toBe(200);
    expect((await gone.json<PrinterResponse>()).bridge).toBeNull();
    expect((await asToken(paired.token, "/api/printer")).status).toBe(401);
    // And it can be paired again.
    expect((await exchange((await makeCode()).code, "203.0.113.9")).status).toBe(200);
  });
});

describe("the bridge's heartbeat", () => {
  it("keeps its version, system and problems, and a quiet one just moves 'last heard'", async () => {
    const paired = await (await exchange((await makeCode()).code)).json<PairResponse>();
    const beat = (json: unknown) => asToken(paired.token, "/api/printer/bridge", { method: "PUT", json });
    const problems = [{ code: "local-network", message: "Can't reach the printer: allow Local Network." }];
    expect((await beat({ printerState: "offline", version: "1.2.3", platform: "darwin-arm64", problems })).status).toBe(
      200,
    );
    const seen = await (await request("/api/printer", { cookie })).json<PrinterResponse>();
    expect(seen.bridge).toMatchObject({
      printerState: "offline",
      version: "1.2.3",
      platform: "darwin-arm64",
      problems,
    });
    const feed = async () =>
      (await env.DB.prepare("SELECT count(*) AS n FROM changes WHERE entity = 'printer'").first<{ n: number }>())?.n;
    const changes = await feed();
    await beat({ printerState: "offline", version: "1.2.3", platform: "darwin-arm64", problems });
    expect(await feed()).toBe(changes);
    await beat({ printerState: "idle", problems: [] });
    const healed = await (await request("/api/printer", { cookie })).json<PrinterResponse>();
    expect(healed.bridge?.problems).toEqual([]);
    expect(healed.bridge?.version).toBe("1.2.3");
    expect(await feed()).toBe((changes ?? 0) + 1);
  });

  it("refuses a problem it doesn't know, or a very long one", async () => {
    const paired = await (await exchange((await makeCode()).code)).json<PairResponse>();
    const beat = (json: unknown) => asToken(paired.token, "/api/printer/bridge", { method: "PUT", json });
    expect((await beat({ problems: [{ code: "nope", message: "x" }] })).status).toBe(400);
    expect((await beat({ problems: [{ code: "silent", message: "x".repeat(500) }] })).status).toBe(400);
  });
});
