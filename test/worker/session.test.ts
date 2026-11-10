import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { addUser, request, resetDb, signIn } from "./helpers.ts";

beforeEach(async () => {
  await resetDb();
  await addUser("alex", "correct horse", "Alex Rivera", "tomato");
});

describe("health", () => {
  it("answers without a session", async () => {
    const response = await request("/api/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });
});

describe("signing in", () => {
  it("rejects a wrong password", async () => {
    const response = await request("/api/session", {
      method: "POST",
      json: { username: "alex", password: "wrong" },
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect(await response.json()).toMatchObject({ error: { code: "wrong_credentials" } });
  });

  it("rejects an unknown name the same way", async () => {
    const response = await request("/api/session", {
      method: "POST",
      json: { username: "nobody", password: "correct horse" },
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "wrong_credentials" } });
  });

  it("rejects a malformed body", async () => {
    const response = await request("/api/session", { method: "POST", json: { username: "alex" } });
    expect(response.status).toBe(400);
  });

  it("sets a long-lived httpOnly cookie and returns the person without credentials", async () => {
    const response = await request("/api/session", {
      method: "POST",
      json: { username: "  Alex ", password: "correct horse" },
    });
    expect(response.status).toBe(200);
    const cookie = response.headers.get("Set-Cookie") ?? "";
    expect(cookie).toMatch(/^spaghetti_session=[\w-]{40,};/);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain(`Max-Age=${400 * 24 * 60 * 60}`);
    const body = await response.json<Record<string, Record<string, unknown>>>();
    expect(body.user).toMatchObject({ username: "alex", name: "Alex Rivera", color: "tomato" });
    expect(body.user).not.toHaveProperty("passwordHash");
  });

  it("stores only a hash of the session token", async () => {
    const cookie = await signIn("alex", "correct horse");
    const token = cookie.split("=")[1];
    const row = await env.DB.prepare("SELECT id FROM sessions").first<{ id: string }>();
    expect(row?.id).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.id).not.toBe(token);
  });

  it("refuses a cross-site form post", async () => {
    const response = await request("/api/session", {
      method: "POST",
      headers: { Origin: "https://evil.example", "Content-Type": "application/x-www-form-urlencoded" },
      body: "username=alex&password=correct+horse",
    });
    expect(response.status).toBe(403);
  });
});

describe("the session", () => {
  it("is 401 when signed out", async () => {
    expect((await request("/api/session")).status).toBe(401);
    expect((await request("/api/people")).status).toBe(401);
  });

  it("returns the signed-in person", async () => {
    const cookie = await signIn("alex", "correct horse");
    const response = await request("/api/session", { cookie });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ user: { username: "alex" } });
  });

  it("ends on sign-out", async () => {
    const cookie = await signIn("alex", "correct horse");
    const response = await request("/api/session", { method: "DELETE", cookie });
    expect(response.status).toBe(204);
    expect(response.headers.get("Set-Cookie")).toContain("Max-Age=0");
    expect((await request("/api/session", { cookie })).status).toBe(401);
  });

  it("expires, and the expired row is removed", async () => {
    const cookie = await signIn("alex", "correct horse");
    await env.DB.prepare("UPDATE sessions SET expires_at = ?")
      .bind(Date.now() - 1000)
      .run();
    expect((await request("/api/session", { cookie })).status).toBe(401);
    const count = await env.DB.prepare("SELECT count(*) AS n FROM sessions").first<{ n: number }>();
    expect(count?.n).toBe(0);
  });

  it("renews itself after a day of use, so a phone stays signed in", async () => {
    const cookie = await signIn("alex", "correct horse");
    const twoDaysAgo = Date.now() - 2 * 24 * 60 * 60 * 1000;
    await env.DB.prepare("UPDATE sessions SET last_seen_at = ?, expires_at = ?")
      .bind(twoDaysAgo, Date.now() + 1000 * 60)
      .run();
    const response = await request("/api/session", { cookie });
    expect(response.status).toBe(200);
    expect(response.headers.get("Set-Cookie")).toContain("spaghetti_session=");
    const row = await env.DB.prepare("SELECT expires_at FROM sessions").first<{ expires_at: number }>();
    expect(row?.expires_at).toBeGreaterThan(Date.now() + 399 * 24 * 60 * 60 * 1000);
  });

  it("doesn't rewrite the cookie on every request", async () => {
    const cookie = await signIn("alex", "correct horse");
    const response = await request("/api/session", { cookie });
    expect(response.headers.get("Set-Cookie")).toBeNull();
  });
});

describe("people", () => {
  it("lists both people, oldest first", async () => {
    await addUser("sam", "another password", "Sam Okafor", "sea");
    const cookie = await signIn("alex", "correct horse");
    const response = await request("/api/people", { cookie });
    const body = await response.json<{ people: Array<{ username: string }> }>();
    expect(body.people.map((p) => p.username)).toEqual(["alex", "sam"]);
  });
});

describe("unknown endpoints", () => {
  it("are 404 JSON once signed in", async () => {
    const cookie = await signIn("alex", "correct horse");
    const response = await request("/api/nope", { cookie });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: "not_found" } });
  });
});

describe("changing your own password", () => {
  const change = (cookie: string, currentPassword: string, newPassword: string) =>
    request("/api/account/password", { method: "PUT", cookie, json: { currentPassword, newPassword } });

  it("sets the new password, keeps this session and ends the others", async () => {
    const here = await signIn("alex", "correct horse");
    const phone = await signIn("alex", "correct horse");
    const response = await change(here, "correct horse", "a brand new pot of pasta");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ signedOut: 1 });
    expect((await request("/api/session", { cookie: here })).status).toBe(200);
    expect((await request("/api/session", { cookie: phone })).status).toBe(401);
    expect(
      (await request("/api/session", { method: "POST", json: { username: "alex", password: "correct horse" } })).status,
    ).toBe(401);
    await signIn("alex", "a brand new pot of pasta");
  });

  it("refuses a wrong current password and leaves everything as it was", async () => {
    const here = await signIn("alex", "correct horse");
    const response = await change(here, "wrong horse", "a brand new pot of pasta");
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "wrong_password" } });
    await signIn("alex", "correct horse");
  });

  it("wants at least 10 characters", async () => {
    const here = await signIn("alex", "correct horse");
    const response = await change(here, "correct horse", "123456789");
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "too_short" } });
    expect((await change(here, "correct horse", "1234567890")).status).toBe(200);
  });

  it("refuses the same password", async () => {
    const here = await signIn("alex", "correct horse");
    const response = await change(here, "correct horse", "correct horse");
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "same_password" } });
  });

  it("needs a session", async () => {
    expect((await change("", "correct horse", "a brand new pot of pasta")).status).toBe(401);
  });

  it("is refused to agent tokens", async () => {
    const here = await signIn("alex", "correct horse");
    const made = await request("/api/agents", {
      method: "POST",
      cookie: here,
      json: { name: "Claude", scopes: ["read", "capture", "attempts", "printer"] },
    });
    const { token } = (await made.json()) as { token: string };
    const response = await request("/api/account/password", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` },
      json: { currentPassword: "correct horse", newPassword: "a brand new pot of pasta" },
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "person_only" } });
    await signIn("alex", "correct horse");
  });

  it("slows down guessing: five wrong passwords, then even the right one waits", async () => {
    const here = await signIn("alex", "correct horse");
    for (let i = 0; i < 5; i++) expect((await change(here, "nope", "a brand new pot of pasta")).status).toBe(403);
    const response = await change(here, "correct horse", "a brand new pot of pasta");
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ error: { code: "rate_limited" } });
    await signIn("alex", "correct horse");
  });

  it("holds parallel guesses to the same five", async () => {
    const here = await signIn("alex", "correct horse");
    const results = await Promise.all(
      Array.from({ length: 12 }, () => change(here, "nope", "a brand new pot of pasta")),
    );
    const codes = results.map((r) => r.status);
    expect(codes.filter((s) => s === 403)).toHaveLength(5);
    expect(codes.filter((s) => s === 429)).toHaveLength(7);
  });

  it("counts failures per person", async () => {
    await addUser("sam", "another horse", "Sam", "basil");
    const alex = await signIn("alex", "correct horse");
    const sam = await signIn("sam", "another horse");
    for (let i = 0; i < 5; i++) await change(alex, "nope", "a brand new pot of pasta");
    expect((await change(sam, "another horse", "a brand new pot of pasta")).status).toBe(200);
  });
});
