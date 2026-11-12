import { beforeAll, describe, expect, it } from "vitest";
import type { NewTokenResponse } from "../../src/shared/agents.ts";
import { app } from "../../src/worker/app.ts";
import { mcpRoutes } from "../../src/worker/mcp/index.ts";
import { oauthEndpoints } from "../../src/worker/oauth/index.ts";
import { addUser, request, resetDb, signIn } from "./helpers.ts";

/**
 * The guard: every route the Worker's routers answer refuses a caller with no valid session or token, except the
 * ones listed here. The list is walked from the routers themselves, so a new route is covered the day it is added;
 * making one public means adding it below, with the reason (docs/security.md).
 */
const PUBLIC: Record<string, string> = {
  "GET /api/health": "a liveness check; says nothing but { ok: true }",
  "POST /api/session": "signing in with a password (rate limited)",
  "POST /api/session/passkey/options": "a sign-in challenge; holds no data",
  "POST /api/session/passkey": "signing in with a passkey (rate limited)",
  "POST /api/session/link": "signing in with a link or code made on a signed-in device (rate limited)",
  "DELETE /api/session": "signing out; without a session it does nothing",
  "POST /api/join/peek": "an invite's inviter and expiry, only with the invite's token",
  "POST /api/join/options": "joining by invite, only with the invite's token",
  "POST /api/join": "joining by invite, only with the invite's token",
  "POST /api/bridge/pair": "the printer bridge trading a pairing code for its token (rate limited)",
  "GET /mcp": "405: the MCP server is POST only",
  "DELETE /mcp": "405: the MCP server is POST only",
  "GET /.well-known/oauth-protected-resource/:rest{.*}?": "OAuth metadata (RFC 9728)",
  "GET /.well-known/oauth-authorization-server/:rest{.*}?": "OAuth metadata (RFC 8414)",
  "POST /oauth/register": "OAuth dynamic client registration (RFC 7591); capped, grants nothing",
  "POST /oauth/token": "OAuth token endpoint: needs a code with its PKCE verifier, or a refresh token",
  "POST /oauth/revoke": "OAuth revocation (RFC 7009): needs the token itself",
};

interface Route {
  method: string;
  path: string;
  handler: { length: number };
}

const routers: Route[] = [...app.routes, ...mcpRoutes.routes, ...oauthEndpoints.routes];
/** Middleware is registered as ALL with a (c, next) handler; anything else answers requests. */
const endpoints = routers.filter((route) => !(route.method === "ALL" && route.handler.length === 2));
const key = (route: Route) => `${route.method} ${route.path}`;
const guarded = endpoints.filter((route) => !(key(route) in PUBLIC));

const SAMPLE = crypto.randomUUID();
/** A concrete address for a route pattern: every parameter (optional or with a pattern) gets a sample id. */
const concrete = (path: string) => path.replace(/:\w+(\{[^}]*\})?\??/g, SAMPLE);

async function call(route: Route, headers: Record<string, string>, method = route.method) {
  const write = method !== "GET" && method !== "HEAD";
  // A same-origin JSON request (request() sends Origin), so the CSRF check passes and only the credentials decide.
  return request(concrete(route.path), { method, headers, ...(write ? { json: {} } : {}) });
}

async function refusals(headers: Record<string, string>) {
  const answered: string[] = [];
  for (const route of guarded) {
    const methods =
      route.method === "GET" ? ["GET", "HEAD"] : route.method === "ALL" ? ["GET", "POST"] : [route.method];
    for (const method of methods) {
      const response = await call(route, headers, method);
      if (response.status !== 401 && response.status !== 403)
        answered.push(`${method} ${route.path} → ${response.status}`);
    }
  }
  return answered;
}

describe("the auth guard", () => {
  let signedOutCookie: string;
  let revokedToken: string;

  beforeAll(async () => {
    await resetDb();
    await addUser("alex", "correct horse", "Alex Rivera", "tomato");
    const cookie = await signIn("alex", "correct horse");
    const made = await (
      await request("/api/agents", { method: "POST", json: { name: "Gone", scopes: ["read", "capture"] }, cookie })
    ).json<NewTokenResponse>();
    revokedToken = made.token;
    const revoked = await request(`/api/agents/${made.agent.id}/tokens/${made.tokenId}`, { method: "DELETE", cookie });
    expect(revoked.ok).toBe(true);
    // A cookie that was real once: signing out ends it on the server.
    expect((await request("/api/session", { method: "DELETE", cookie })).status).toBe(204);
    signedOutCookie = cookie;
  });

  it("walks a router that has the routes it should", () => {
    expect(guarded.length).toBeGreaterThan(100);
    expect(guarded.map(key)).toContain("GET /api/photos/:id/:variant");
    expect(guarded.map(key)).toContain("POST /mcp");
  });

  it("lists only public routes that exist", () => {
    const known = new Set(endpoints.map(key));
    expect(Object.keys(PUBLIC).filter((route) => !known.has(route))).toEqual([]);
  });

  it("refuses every other route without credentials", async () => {
    expect(await refusals({})).toEqual([]);
  });

  it("refuses them with a session that was signed out", async () => {
    expect(await refusals({ Cookie: signedOutCookie })).toEqual([]);
  });

  it("refuses them with a revoked token, and with something that isn't a token", async () => {
    expect(await refusals({ Authorization: `Bearer ${revokedToken}` })).toEqual([]);
    expect(await refusals({ Authorization: "Bearer not-a-token" })).toEqual([]);
  });

  it("never answers a refusal with data", async () => {
    const response = await request(`/api/items/${SAMPLE}`);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: "signed_out", message: "Not signed in." } });
  });
});
