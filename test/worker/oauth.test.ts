import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { AgentsResponse } from "../../src/shared/agents.ts";
import type { AuthorizeRequestInfo } from "../../src/shared/oauth.ts";
import { addUser, ORIGIN, request, resetDb, signIn } from "./helpers.ts";

const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
let cookie: string;

beforeEach(async () => {
  await resetDb();
  await addUser("alex", "correct horse", "Carl Oscar", "tomato");
  cookie = await signIn("alex", "correct horse");
});

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

async function pkce() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  return { verifier, challenge };
}

async function register(body: Record<string, unknown> = {}) {
  const response = await request("/oauth/register", {
    method: "POST",
    json: { client_name: "Claude", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none", ...body },
  });
  return { response, body: await response.json<Record<string, string>>() };
}

function form(fields: Record<string, string>) {
  return {
    method: "POST",
    body: new URLSearchParams(fields),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  };
}

const token = async (fields: Record<string, string>) => {
  const response = await request("/oauth/token", form(fields));
  return { response, body: await response.json<Record<string, string | number>>() };
};

/** Registers, asks, approves, and returns the code. */
async function approve(options: { scope?: string; client?: string } = {}) {
  const clientId = options.client ?? (await register()).body.client_id;
  const { verifier, challenge } = await pkce();
  const params = {
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "abc 123",
    ...(options.scope ? { scope: options.scope } : {}),
  } as Record<string, string>;
  const response = await request("/api/oauth/decision", { method: "POST", cookie, json: { ...params, approve: true } });
  expect(response.status).toBe(200);
  const { redirectTo } = await response.json<{ redirectTo: string }>();
  const url = new URL(redirectTo);
  expect(url.searchParams.get("state")).toBe("abc 123");
  expect(url.searchParams.get("iss")).toBe(ORIGIN);
  return { code: url.searchParams.get("code") as string, verifier, clientId, params };
}

const exchange = (a: { code: string; verifier: string; clientId: string }, extra: Record<string, string> = {}) =>
  token({
    grant_type: "authorization_code",
    code: a.code,
    code_verifier: a.verifier,
    client_id: a.clientId,
    redirect_uri: REDIRECT,
    ...extra,
  });

describe("metadata", () => {
  it("describes the resource and the authorization server", async () => {
    for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]) {
      const body = await (await request(path)).json<Record<string, unknown>>();
      expect(body.resource).toBe(`${ORIGIN}/mcp`);
      expect(body.authorization_servers).toEqual([ORIGIN]);
      expect(body.scopes_supported).toEqual(["read", "capture", "attempts", "printer"]);
    }
    const meta = await (await request("/.well-known/oauth-authorization-server")).json<Record<string, unknown>>();
    expect(meta).toMatchObject({
      issuer: ORIGIN,
      authorization_endpoint: `${ORIGIN}/authorize`,
      token_endpoint: `${ORIGIN}/oauth/token`,
      registration_endpoint: `${ORIGIN}/oauth/register`,
      code_challenge_methods_supported: ["S256"],
      grant_types_supported: ["authorization_code", "refresh_token"],
    });
  });

  it("points a client without a token at the metadata", async () => {
    const response = await request("/mcp", { method: "POST", json: { jsonrpc: "2.0", id: 1, method: "ping" } });
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain(
      `resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp"`,
    );
    const stale = await request("/mcp", {
      method: "POST",
      headers: { Authorization: "Bearer spg_nope" },
      json: { jsonrpc: "2.0", id: 1, method: "ping" },
    });
    expect(stale.headers.get("WWW-Authenticate")).toContain('error="invalid_token"');
  });
});

describe("registration", () => {
  it("registers a public client", async () => {
    const { response, body } = await register();
    expect(response.status).toBe(201);
    expect(body.client_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.token_endpoint_auth_method).toBe("none");
    expect(body.client_secret).toBeUndefined();
  });

  it("refuses redirect addresses that could run code or leave the person's machine unprotected", async () => {
    for (const uri of ["javascript:alert(1)", "http://evil.example/cb", "https://a.example/cb#frag", "not a url"]) {
      const { response, body } = await register({ redirect_uris: [uri] });
      expect(response.status, uri).toBe(400);
      expect(body.error).toBe("invalid_redirect_uri");
    }
    expect(
      (await register({ redirect_uris: ["http://127.0.0.1:33418/callback", "claude://cb"] })).response.status,
    ).toBe(201);
  });

  it("stores a secret only as a hash, and asks for it at the token endpoint", async () => {
    const { body } = await register({ token_endpoint_auth_method: "client_secret_post" });
    expect(body.client_secret).toMatch(/^sps_/);
    const stored = await env.DB.prepare("SELECT secret_hash FROM oauth_clients WHERE id = ?")
      .bind(body.client_id)
      .first<{ secret_hash: string }>();
    expect(stored?.secret_hash).not.toContain(body.client_secret);
    const a = await approve({ client: body.client_id });
    expect((await exchange(a)).response.status).toBe(401);
    const a2 = await approve({ client: body.client_id });
    expect((await exchange(a2, { client_secret: body.client_secret as string })).response.status).toBe(200);
  });
});

describe("the consent request", () => {
  it("says who asks and for what, for a signed-in person only", async () => {
    const { body: client } = await register();
    const { challenge } = await pkce();
    const query = new URLSearchParams({
      response_type: "code",
      client_id: client.client_id as string,
      redirect_uri: REDIRECT,
      code_challenge: challenge,
      code_challenge_method: "S256",
      scope: "read capture offline_access",
    });
    expect((await request(`/api/oauth/request?${query}`)).status).toBe(401);
    const info = await (await request(`/api/oauth/request?${query}`, { cookie })).json<AuthorizeRequestInfo>();
    expect(info).toEqual({ app: "Claude", returnsTo: "claude.ai", scopes: ["read", "capture"] });
  });

  it("asks for everything when no scope is named", async () => {
    const { body: client } = await register();
    const { challenge } = await pkce();
    const query = new URLSearchParams({
      response_type: "code",
      client_id: client.client_id as string,
      redirect_uri: REDIRECT,
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    const info = await (await request(`/api/oauth/request?${query}`, { cookie })).json<AuthorizeRequestInfo>();
    expect(info.scopes).toEqual(["read", "capture", "attempts", "printer"]);
  });

  it("refuses a redirect address the client didn't register, plain PKCE and no PKCE, and a token can't answer", async () => {
    const { body: client } = await register();
    const { challenge } = await pkce();
    const base = {
      response_type: "code",
      client_id: client.client_id as string,
      redirect_uri: REDIRECT,
      code_challenge: challenge,
      code_challenge_method: "S256",
    };
    const ask = (over: Record<string, string>) =>
      request(`/api/oauth/request?${new URLSearchParams({ ...base, ...over })}`, { cookie });
    expect((await ask({ redirect_uri: "https://evil.example/cb" })).status).toBe(400);
    expect((await ask({ code_challenge_method: "plain" })).status).toBe(400);
    expect((await ask({ code_challenge: "short" })).status).toBe(400);
    expect((await ask({ client_id: "nobody" })).status).toBe(400);
    expect((await ask({ resource: "https://other.example/mcp" })).status).toBe(400);
    expect((await ask({ resource: `${ORIGIN}/mcp` })).status).toBe(200);
  });

  it("sends a decline back to the app", async () => {
    const { body: client } = await register();
    const { challenge } = await pkce();
    const response = await request("/api/oauth/decision", {
      method: "POST",
      cookie,
      json: {
        response_type: "code",
        client_id: client.client_id,
        redirect_uri: REDIRECT,
        code_challenge: challenge,
        code_challenge_method: "S256",
        state: "s",
        approve: false,
      },
    });
    const url = new URL((await response.json<{ redirectTo: string }>()).redirectTo);
    expect(url.searchParams.get("error")).toBe("access_denied");
    expect(url.searchParams.get("state")).toBe("s");
    expect(url.searchParams.get("code")).toBeNull();
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM oauth_codes").first<{ n: number }>())?.n).toBe(0);
  });
});

describe("the code exchange", () => {
  it("gives an agent of that person tokens that work on /mcp", async () => {
    const a = await approve({ scope: "read capture" });
    const { response, body } = await exchange(a);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(body).toMatchObject({ token_type: "Bearer", expires_in: 3600, scope: "read capture" });
    expect(String(body.access_token)).toMatch(/^spg_/);
    expect(String(body.refresh_token)).toMatch(/^spr_/);

    const mcp = await request("/mcp", {
      method: "POST",
      headers: { Authorization: `Bearer ${body.access_token}` },
      json: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_spools", arguments: {} } },
    });
    expect(mcp.status).toBe(200);

    const { agents } = await (await request("/api/agents", { cookie })).json<AgentsResponse>();
    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({
      name: "Claude for Carl Oscar",
      tokens: [],
      connection: { app: "Claude", scopes: ["read", "capture"], connected: true },
    });
  });

  it("stores only hashes", async () => {
    const a = await approve();
    const { body } = await exchange(a);
    const rows = await env.DB.prepare("SELECT hash FROM agent_tokens UNION SELECT hash FROM oauth_refresh_tokens").all<{
      hash: string;
    }>();
    expect(rows.results).toHaveLength(2);
    for (const row of rows.results) expect([body.access_token, body.refresh_token]).not.toContain(row.hash);
  });

  it("is used once", async () => {
    const a = await approve();
    expect((await exchange(a)).response.status).toBe(200);
    const again = await exchange(a);
    expect(again.response.status).toBe(400);
    expect(again.body.error).toBe("invalid_grant");
  });

  it("refuses a wrong verifier, and spends the code doing so", async () => {
    const a = await approve();
    const wrong = await exchange({ ...a, verifier: (await pkce()).verifier });
    expect(wrong.body.error).toBe("invalid_grant");
    expect((await exchange(a)).body.error).toBe("invalid_grant");
  });

  it("refuses an expired code", async () => {
    const a = await approve();
    await env.DB.prepare("UPDATE oauth_codes SET expires_at = ?")
      .bind(Date.now() - 1000)
      .run();
    expect((await exchange(a)).body.error).toBe("invalid_grant");
  });

  it("refuses another redirect address or another client", async () => {
    const a = await approve();
    expect((await exchange(a, { redirect_uri: "https://claude.ai/other" })).body.error).toBe("invalid_grant");
    const b = await approve();
    const other = (await register({ client_name: "Other" })).body.client_id;
    expect((await exchange({ ...b, clientId: other })).body.error).toBe("invalid_grant");
  });

  it("refuses a scope it wasn't granted, and narrows to one it was", async () => {
    const a = await approve({ scope: "read" });
    expect((await exchange(a, { scope: "read printer" })).body.error).toBe("invalid_scope");
    const b = await approve({ scope: "read capture" });
    expect((await exchange(b, { scope: "read" })).body.scope).toBe("read");
  });

  it("refuses an unknown client and grant type", async () => {
    expect((await token({ grant_type: "authorization_code", client_id: "nobody", code: "x" })).response.status).toBe(
      401,
    );
    const id = (await register()).body.client_id as string;
    expect((await token({ grant_type: "password", client_id: id })).body.error).toBe("unsupported_grant_type");
  });

  it("keeps one agent per person and app across connections", async () => {
    await exchange(await approve());
    const clientId = (await env.DB.prepare("SELECT id FROM oauth_clients").first<{ id: string }>())?.id as string;
    await exchange(await approve({ client: clientId }));
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM agents").first<{ n: number }>())?.n).toBe(1);
  });
});

describe("refreshing", () => {
  const refresh = (clientId: string, refreshToken: string, extra: Record<string, string> = {}) =>
    token({ grant_type: "refresh_token", client_id: clientId, refresh_token: refreshToken, ...extra });

  it("swaps a refresh token for a new pair, once", async () => {
    const a = await approve();
    const first = (await exchange(a)).body;
    const second = await refresh(a.clientId, String(first.refresh_token));
    expect(second.response.status).toBe(200);
    expect(second.body.refresh_token).not.toBe(first.refresh_token);
    expect((await refresh(a.clientId, String(first.refresh_token))).body.error).toBe("invalid_grant");
    const call = await request("/mcp", {
      method: "POST",
      headers: { Authorization: `Bearer ${second.body.access_token}` },
      json: { jsonrpc: "2.0", id: 1, method: "ping" },
    });
    expect(call.status).toBe(200);
  });

  it("is refused for another client, an expired token, and a wider scope", async () => {
    const a = await approve({ scope: "read" });
    const first = (await exchange(a)).body;
    const other = (await register({ client_name: "Other" })).body.client_id as string;
    expect((await refresh(other, String(first.refresh_token))).body.error).toBe("invalid_grant");

    const b = await approve({ scope: "read" });
    const second = (await exchange(b)).body;
    expect((await refresh(b.clientId, String(second.refresh_token), { scope: "read printer" })).body.error).toBe(
      "invalid_scope",
    );

    const c = await approve({ scope: "read" });
    const third = (await exchange(c)).body;
    await env.DB.prepare("UPDATE oauth_refresh_tokens SET expires_at = ?")
      .bind(Date.now() - 1000)
      .run();
    expect((await refresh(c.clientId, String(third.refresh_token))).body.error).toBe("invalid_grant");
  });

  it("stops access tokens that ran out", async () => {
    const a = await approve();
    const { access_token } = (await exchange(a)).body;
    await env.DB.prepare("UPDATE agent_tokens SET expires_at = ?")
      .bind(Date.now() - 1000)
      .run();
    const call = await request("/mcp", {
      method: "POST",
      headers: { Authorization: `Bearer ${access_token}` },
      json: { jsonrpc: "2.0", id: 1, method: "ping" },
    });
    expect(call.status).toBe(401);
  });
});

describe("revoking", () => {
  const ping = async (accessToken: unknown) =>
    (
      await request("/mcp", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        json: { jsonrpc: "2.0", id: 1, method: "ping" },
      })
    ).status;

  it("disconnecting on the Agents page ends every token at once", async () => {
    const a = await approve();
    const first = (await exchange(a)).body;
    const { agents } = await (await request("/api/agents", { cookie })).json<AgentsResponse>();
    expect(await ping(first.access_token)).toBe(200);
    const gone = await request(`/api/agents/${agents[0]?.id}/connection`, { method: "DELETE", cookie });
    expect(gone.status).toBe(204);
    expect(await ping(first.access_token)).toBe(401);
    expect(
      (await token({ grant_type: "refresh_token", client_id: a.clientId, refresh_token: String(first.refresh_token) }))
        .body.error,
    ).toBe("invalid_grant");
    const after = await (await request("/api/agents", { cookie })).json<AgentsResponse>();
    expect(after.agents[0]?.connection?.connected).toBe(false);
  });

  it("connecting again after a disconnect works", async () => {
    const a = await approve();
    await exchange(a);
    const { agents } = await (await request("/api/agents", { cookie })).json<AgentsResponse>();
    await request(`/api/agents/${agents[0]?.id}/connection`, { method: "DELETE", cookie });
    const again = await exchange(await approve({ client: a.clientId }));
    expect(again.response.status).toBe(200);
    expect(await ping(again.body.access_token)).toBe(200);
  });

  it("the app can revoke itself (RFC 7009), and an unknown token is still 200", async () => {
    const a = await approve();
    const first = (await exchange(a)).body;
    const response = await request(
      "/oauth/revoke",
      form({ token: String(first.refresh_token), client_id: a.clientId }),
    );
    expect(response.status).toBe(200);
    expect(await ping(first.access_token)).toBe(401);
    expect((await request("/oauth/revoke", form({ token: "spr_unknown", client_id: a.clientId }))).status).toBe(200);
  });

  it("another client can't revoke it", async () => {
    const a = await approve();
    const first = (await exchange(a)).body;
    const other = (await register({ client_name: "Other" })).body.client_id as string;
    await request("/oauth/revoke", form({ token: String(first.access_token), client_id: other }));
    expect(await ping(first.access_token)).toBe(200);
  });

  it("only the owner can disconnect, and typed-in agents have no connection", async () => {
    const a = await approve();
    await exchange(a);
    const { agents } = await (await request("/api/agents", { cookie })).json<AgentsResponse>();
    await addUser("marie", "another pass", "Marie", "basil");
    const marie = await signIn("marie", "another pass");
    expect((await request(`/api/agents/${agents[0]?.id}/connection`, { method: "DELETE", cookie: marie })).status).toBe(
      404,
    );
    const typed = await (
      await request("/api/agents", { method: "POST", cookie, json: { name: "Bridge", scopes: ["read"] } })
    ).json<{ agent: { id: string } }>();
    expect((await request(`/api/agents/${typed.agent.id}/connection`, { method: "DELETE", cookie })).status).toBe(404);
    expect(
      (await request(`/api/agents/${agents[0]?.id}/tokens`, { method: "POST", cookie, json: { scopes: ["read"] } }))
        .status,
    ).toBe(400);
  });
});

describe("bearer tokens", () => {
  it("typed-in tokens keep working unchanged", async () => {
    const made = await (
      await request("/api/agents", { method: "POST", cookie, json: { name: "Claude Code", scopes: ["read"] } })
    ).json<{ token: string }>();
    const call = await request("/mcp", {
      method: "POST",
      headers: { Authorization: `Bearer ${made.token}` },
      json: { jsonrpc: "2.0", id: 1, method: "ping" },
    });
    expect(call.status).toBe(200);
  });
});
