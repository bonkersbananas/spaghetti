import { env } from "cloudflare:workers";
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/server";
import { beforeEach, describe, expect, it } from "vitest";
import type { NewTokenResponse } from "../../src/shared/agents.ts";
import type { PeopleResponse, SessionResponse } from "../../src/shared/api.ts";
import { toBase64Url } from "../../src/shared/base64url.ts";
import type {
  CeremonyOptions,
  DevicesResponse,
  InvitePeek,
  InvitesResponse,
  NewInvite,
  NewSignInLink,
  PasskeyInfo,
  PasskeysResponse,
  SignInLinkInfo,
} from "../../src/shared/signing-in.ts";
import { SoftAuthenticator } from "./authenticator.ts";
import { addUser, ORIGIN, request, resetDb, signIn } from "./helpers.ts";

const RP = "spaghetti.test";
let alex: string;
let cookie: string;

beforeEach(async () => {
  await resetDb();
  alex = await addUser("alex", "correct horse", "Alex Rivera", "tomato");
  await addUser("sam", "battery staple", "Sam Lund", "basil");
  cookie = await signIn("alex", "correct horse");
});

const cookieOf = (response: Response) => (response.headers.get("Set-Cookie") ?? "").split(";")[0] ?? "";
const errorOf = async (response: Response) =>
  (await response.json<{ error: { code: string; message: string } }>()).error;
const handle = (id: string) => toBase64Url(new TextEncoder().encode(id));

async function registrationOptions(as = cookie) {
  const response = await request("/api/account/passkeys/options", { method: "POST", cookie: as });
  expect(response.status).toBe(200);
  return response.json<CeremonyOptions<PublicKeyCredentialCreationOptionsJSON>>();
}

/** Adds a passkey for whoever `as` is, the way the browser does. */
async function addPasskey(key = new SoftAuthenticator(), as = cookie) {
  const { ceremonyId, options } = await registrationOptions(as);
  const response = await request("/api/account/passkeys", {
    method: "POST",
    cookie: as,
    json: { ceremonyId, response: await key.register({ challenge: options.challenge, rpId: RP, origin: ORIGIN }) },
  });
  return { key, response };
}

async function authOptions() {
  const response = await request("/api/session/passkey/options", { method: "POST" });
  expect(response.status).toBe(200);
  return response.json<CeremonyOptions<PublicKeyCredentialRequestOptionsJSON>>();
}

async function signInWith(
  key: SoftAuthenticator,
  overrides: { origin?: string; counter?: number; userHandle?: string } = {},
) {
  const { ceremonyId, options } = await authOptions();
  const assertion = await key.authenticate({
    challenge: options.challenge,
    rpId: RP,
    origin: overrides.origin ?? ORIGIN,
    counter: overrides.counter,
    userHandle: overrides.userHandle ?? handle(alex),
  });
  return {
    ceremonyId,
    assertion,
    response: await request("/api/session/passkey", { method: "POST", json: { ceremonyId, response: assertion } }),
  };
}

describe("adding a passkey", () => {
  it("asks for Face ID every time and a discoverable passkey, and names the device from its browser", async () => {
    const { options } = await registrationOptions();
    expect(options.rp).toMatchObject({ id: RP, name: "Spaghetti" });
    expect(options.authenticatorSelection).toMatchObject({ residentKey: "required", userVerification: "required" });
    expect(options.user.name).toBe("alex");

    const key = new SoftAuthenticator({ backedUp: true });
    const { ceremonyId, options: second } = await registrationOptions();
    const added = await request("/api/account/passkeys", {
      method: "POST",
      cookie,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
      },
      json: { ceremonyId, response: await key.register({ challenge: second.challenge, rpId: RP, origin: ORIGIN }) },
    });
    expect(added.status).toBe(201);
    const passkey = await added.json<PasskeyInfo>();
    expect(passkey).toMatchObject({ name: "iPhone", lastUsedAt: null, backedUp: true });
    const list = await (await request("/api/account/passkeys", { cookie })).json<PasskeysResponse>();
    expect(list.passkeys.map((p) => p.id)).toEqual([key.id]);
    // The stored row holds a public key, never anything that could sign.
    const row = await env.DB.prepare("SELECT public_key, user_id FROM passkeys").first<{
      public_key: string;
      user_id: string;
    }>();
    expect(row?.user_id).toBe(alex);
  });

  it("needs a signed-in person", async () => {
    expect((await request("/api/account/passkeys/options", { method: "POST" })).status).toBe(401);
    expect((await request("/api/account/passkeys")).status).toBe(401);
  });

  it("refuses a different challenge, another origin, a missing Face ID and another person's ceremony", async () => {
    const wrongChallenge = await registrationOptions();
    const a = await request("/api/account/passkeys", {
      method: "POST",
      cookie,
      json: {
        ceremonyId: wrongChallenge.ceremonyId,
        response: await new SoftAuthenticator().register({
          challenge: toBase64Url(crypto.getRandomValues(new Uint8Array(32))),
          rpId: RP,
          origin: ORIGIN,
        }),
      },
    });
    expect(a.status).toBe(400);

    const wrongOrigin = await registrationOptions();
    const b = await request("/api/account/passkeys", {
      method: "POST",
      cookie,
      json: {
        ceremonyId: wrongOrigin.ceremonyId,
        response: await new SoftAuthenticator().register({
          challenge: wrongOrigin.options.challenge,
          rpId: RP,
          origin: "https://evil.example",
        }),
      },
    });
    expect(b.status).toBe(400);

    const wrongRp = await registrationOptions();
    const c = await request("/api/account/passkeys", {
      method: "POST",
      cookie,
      json: {
        ceremonyId: wrongRp.ceremonyId,
        response: await new SoftAuthenticator().register({
          challenge: wrongRp.options.challenge,
          rpId: "evil.example",
          origin: ORIGIN,
        }),
      },
    });
    expect(c.status).toBe(400);

    const noFaceId = await registrationOptions();
    const d = await request("/api/account/passkeys", {
      method: "POST",
      cookie,
      json: {
        ceremonyId: noFaceId.ceremonyId,
        response: await new SoftAuthenticator({ verified: false }).register({
          challenge: noFaceId.options.challenge,
          rpId: RP,
          origin: ORIGIN,
        }),
      },
    });
    expect(d.status).toBe(400);

    // Sam can't finish a ceremony Alex started.
    const sam = await signIn("sam", "battery staple");
    const mine = await registrationOptions();
    const e = await request("/api/account/passkeys", {
      method: "POST",
      cookie: sam,
      json: {
        ceremonyId: mine.ceremonyId,
        response: await new SoftAuthenticator().register({
          challenge: mine.options.challenge,
          rpId: RP,
          origin: ORIGIN,
        }),
      },
    });
    expect(e.status).toBe(400);
    expect((await env.DB.prepare("SELECT count(*) AS n FROM passkeys").first<{ n: number }>())?.n).toBe(0);
  });

  it("answers a ceremony once, and not after it expired", async () => {
    const key = new SoftAuthenticator();
    const { ceremonyId, options } = await registrationOptions();
    const answer = await key.register({ challenge: options.challenge, rpId: RP, origin: ORIGIN });
    const send = () =>
      request("/api/account/passkeys", { method: "POST", cookie, json: { ceremonyId, response: answer } });
    expect((await send()).status).toBe(201);
    expect((await send()).status).toBe(400);

    const late = await registrationOptions();
    await env.DB.prepare("UPDATE webauthn_challenges SET expires_at = ?")
      .bind(Date.now() - 1000)
      .run();
    const expired = await request("/api/account/passkeys", {
      method: "POST",
      cookie,
      json: {
        ceremonyId: late.ceremonyId,
        response: await new SoftAuthenticator().register({
          challenge: late.options.challenge,
          rpId: RP,
          origin: ORIGIN,
        }),
      },
    });
    expect(expired.status).toBe(400);
    expect((await errorOf(expired)).code).toBe("expired");
  });

  it("renames and removes only your own", async () => {
    const { key } = await addPasskey();
    const sam = await signIn("sam", "battery staple");
    expect(
      (await request(`/api/account/passkeys/${key.id}`, { method: "PATCH", cookie: sam, json: { name: "Mine now" } }))
        .status,
    ).toBe(404);
    await request(`/api/account/passkeys/${key.id}`, { method: "DELETE", cookie: sam });
    expect((await env.DB.prepare("SELECT count(*) AS n FROM passkeys").first<{ n: number }>())?.n).toBe(1);

    const renamed = await request(`/api/account/passkeys/${key.id}`, {
      method: "PATCH",
      cookie,
      json: { name: "  Kitchen iPad " },
    });
    expect((await renamed.json<PasskeyInfo>()).name).toBe("Kitchen iPad");
    expect(
      (await request(`/api/account/passkeys/${key.id}`, { method: "PATCH", cookie, json: { name: "" } })).status,
    ).toBe(400);
    expect((await request(`/api/account/passkeys/${key.id}`, { method: "DELETE", cookie })).status).toBe(204);
    const list = await (await request("/api/account/passkeys", { cookie })).json<PasskeysResponse>();
    expect(list.passkeys).toEqual([]);
  });
});

describe("password sign-in", () => {
  const attempt = (username: string, password: string, ip = "198.51.100.7") =>
    request("/api/session", { method: "POST", json: { username, password }, headers: { "cf-connecting-ip": ip } });

  it("waits after ten wrong passwords for one name, without counting right ones, and only for that name", async () => {
    for (let i = 0; i < 12; i++) expect((await attempt("alex", "right?")).status).toBe(i < 10 ? 401 : 429);
    const refused = await attempt("alex", "correct horse");
    expect(refused.status).toBe(429);
    expect((await errorOf(refused)).message).toMatch(/wait a few minutes/i);
    // Another name from the same address still signs in.
    expect((await attempt("sam", "battery staple")).status).toBe(200);
    // Ten minutes later it is allowed again.
    await env.DB.prepare("UPDATE auth_hits SET at = at - ?")
      .bind(11 * 60 * 1000)
      .run();
    expect((await attempt("alex", "correct horse")).status).toBe(200);
  });

  it("counts a burst of parallel wrong passwords too: no more than ten are checked", async () => {
    const statuses = (await Promise.all(Array.from({ length: 16 }, () => attempt("alex", "nope")))).map(
      (r) => r.status,
    );
    expect(statuses.filter((s) => s === 401)).toHaveLength(10);
    expect(statuses.filter((s) => s === 429)).toHaveLength(6);
  });

  it("does not count successful sign-ins", async () => {
    for (let i = 0; i < 40; i++) expect((await attempt("alex", "correct horse")).status).toBe(200);
  });

  it("limits an address across names, and an unknown name counts too", async () => {
    let last = 0;
    for (let i = 0; i < 31; i++) last = (await attempt(`nobody${i}`, "x")).status;
    expect(last).toBe(429);
    expect((await attempt("alex", "correct horse")).status).toBe(429);
    // Another address is untouched.
    expect((await attempt("alex", "correct horse", "198.51.100.8")).status).toBe(200);
  });
});

describe("the last way in", () => {
  it("keeps a passkey-only person's last passkey, and lets a person with a password remove theirs", async () => {
    const { key } = await addPasskey();
    expect((await (await request("/api/account/passkeys", { cookie })).json<PasskeysResponse>()).hasPassword).toBe(
      true,
    );
    // Make Alex passkey-only, as joining by invite with a passkey does.
    await env.DB.prepare("UPDATE users SET password_hash = '!' WHERE id = ?").bind(alex).run();
    expect((await (await request("/api/account/passkeys", { cookie })).json<PasskeysResponse>()).hasPassword).toBe(
      false,
    );
    const refused = await request(`/api/account/passkeys/${key.id}`, { method: "DELETE", cookie });
    expect(refused.status).toBe(409);
    expect((await errorOf(refused)).code).toBe("last_way_in");
    expect((await env.DB.prepare("SELECT count(*) AS n FROM passkeys").first<{ n: number }>())?.n).toBe(1);
    // With a second one, either can go.
    const second = await addPasskey();
    expect((await request(`/api/account/passkeys/${key.id}`, { method: "DELETE", cookie })).status).toBe(204);
    expect((await request(`/api/account/passkeys/${second.key.id}`, { method: "DELETE", cookie })).status).toBe(409);
  });
});

describe("signing in with a passkey", () => {
  it("signs in the person it belongs to, counts up and remembers when it was used", async () => {
    const { key } = await addPasskey();
    const { response } = await signInWith(key);
    expect(response.status).toBe(200);
    const body = await response.json<SessionResponse>();
    expect(body.user.username).toBe("alex");
    const session = await request("/api/session", { cookie: cookieOf(response) });
    expect(session.status).toBe(200);
    const row = await env.DB.prepare("SELECT counter, last_used_at FROM passkeys").first<{
      counter: number;
      last_used_at: number;
    }>();
    expect(row?.counter).toBe(1);
    expect(row?.last_used_at).toBeGreaterThan(0);
  });

  it("refuses a replayed answer and a counter that goes back", async () => {
    const { key } = await addPasskey();
    const first = await signInWith(key, { counter: 5 });
    expect(first.response.status).toBe(200);
    // The same answer again: its ceremony is spent.
    const replay = await request("/api/session/passkey", {
      method: "POST",
      json: { ceremonyId: first.ceremonyId, response: first.assertion },
    });
    expect(replay.status).toBe(401);
    // A copy of the key that counts from an older number is a clone.
    const clone = await signInWith(key, { counter: 3 });
    expect(clone.response.status).toBe(401);
    expect((await env.DB.prepare("SELECT counter FROM passkeys").first<{ counter: number }>())?.counter).toBe(5);
  });

  it("refuses another origin, an unknown passkey, a removed one and someone else's handle", async () => {
    const { key } = await addPasskey();
    expect((await signInWith(key, { origin: "https://evil.example" })).response.status).toBe(401);
    expect((await signInWith(key, { userHandle: handle("someone-else") })).response.status).toBe(401);
    expect((await signInWith(new SoftAuthenticator())).response.status).toBe(401);
    // A challenge made for a registration is no sign-in challenge.
    const { ceremonyId, options } = await registrationOptions();
    const assertion = await key.authenticate({ challenge: options.challenge, rpId: RP, origin: ORIGIN });
    expect(
      (await request("/api/session/passkey", { method: "POST", json: { ceremonyId, response: assertion } })).status,
    ).toBe(401);
    await request(`/api/account/passkeys/${key.id}`, { method: "DELETE", cookie });
    expect((await signInWith(key)).response.status).toBe(401);
    const none = await request("/api/session/passkey", { method: "POST", json: { nope: 1 } });
    expect(none.status).toBe(401);
  });

  it("refuses an expired ceremony", async () => {
    const { key } = await addPasskey();
    const { ceremonyId, options } = await authOptions();
    await env.DB.prepare("UPDATE webauthn_challenges SET expires_at = ?")
      .bind(Date.now() - 1000)
      .run();
    const assertion = await key.authenticate({ challenge: options.challenge, rpId: RP, origin: ORIGIN });
    expect(
      (await request("/api/session/passkey", { method: "POST", json: { ceremonyId, response: assertion } })).status,
    ).toBe(401);
  });

  it("is rate limited", async () => {
    let last = 0;
    for (let i = 0; i < 41; i++) {
      last = (
        await request("/api/session/passkey", { method: "POST", json: { ceremonyId: "x", response: { id: "y" } } })
      ).status;
    }
    expect(last).toBe(429);
    await env.DB.prepare("DELETE FROM auth_hits").run();
    for (let i = 0; i < 301; i++) last = (await request("/api/session/passkey/options", { method: "POST" })).status;
    expect(last).toBe(429);
  });
});

describe("signing in on another device", () => {
  async function makeLink(as = cookie) {
    const response = await request("/api/account/sign-in-links", { method: "POST", cookie: as });
    expect(response.status).toBe(201);
    return response.json<NewSignInLink>();
  }
  const redeem = (json: Record<string, unknown>, headers: Record<string, string> = {}) =>
    request("/api/session/link", { method: "POST", json, headers });

  it("makes a link whose secret stays in the fragment, and a code, and stores only hashes", async () => {
    const link = await makeLink();
    expect(link.url).toMatch(new RegExp(`^${ORIGIN}/link#spl_[A-Za-z0-9_-]{43}$`));
    expect(link.code).toMatch(/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
    expect(link.expiresAt - link.createdAt).toBe(10 * 60 * 1000);
    const token = link.url.split("#")[1] ?? "";
    const row = await env.DB.prepare("SELECT token_hash, code_hash FROM sign_in_links").first<{
      token_hash: string;
      code_hash: string;
    }>();
    expect(JSON.stringify(row)).not.toContain(token);
    expect(JSON.stringify(row)).not.toContain(link.code.replace("-", ""));
  });

  it("signs in only the person who made it, once, and tells the first device", async () => {
    const link = await makeLink();
    const token = link.url.split("#")[1] ?? "";
    const opened = await redeem(
      { token },
      {
        "User-Agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
      },
    );
    expect(opened.status).toBe(200);
    expect((await opened.json<SessionResponse>()).user.id).toBe(alex);
    expect((await request("/api/session", { cookie: cookieOf(opened) })).status).toBe(200);

    const again = await redeem({ token });
    expect(again.status).toBe(410);
    expect(again.headers.get("Set-Cookie")).toBeNull();

    const status = await (await request(`/api/account/sign-in-links/${link.id}`, { cookie })).json<SignInLinkInfo>();
    expect(status.usedOn).toBe("iPhone");
    expect(status.usedAt).not.toBeNull();
    const feed = await env.DB.prepare("SELECT entity, entity_id FROM changes WHERE entity = 'signin'").first<{
      entity_id: string;
    }>();
    expect(feed?.entity_id).toBe(link.id);
    // Sam can't read Alex's links.
    const sam = await signIn("sam", "battery staple");
    expect((await request(`/api/account/sign-in-links/${link.id}`, { cookie: sam })).status).toBe(404);
  });

  it("works with the code, as the same single use", async () => {
    const link = await makeLink();
    const opened = await redeem({ code: link.code.toLowerCase().replace("-", " ") });
    expect(opened.status).toBe(200);
    expect((await redeem({ code: link.code })).status).toBe(410);
    expect((await redeem({ code: "nope" })).status).toBe(400);
  });

  it("expires after ten minutes", async () => {
    const link = await makeLink();
    await env.DB.prepare("UPDATE sign_in_links SET expires_at = ?")
      .bind(Date.now() - 1)
      .run();
    const response = await redeem({ token: link.url.split("#")[1] });
    expect(response.status).toBe(410);
    expect((await errorOf(response)).message).toMatch(/expired/);
  });

  it("is replaced by a newer one, and can be cancelled", async () => {
    const first = await makeLink();
    const second = await makeLink();
    expect((await redeem({ token: first.url.split("#")[1] })).status).toBe(410);
    await request(`/api/account/sign-in-links/${second.id}`, { method: "DELETE", cookie });
    expect((await redeem({ token: second.url.split("#")[1] })).status).toBe(410);
  });

  it("is rate limited, and wrong codes anywhere share an allowance", async () => {
    let last = 0;
    for (let i = 0; i < 31; i++) last = (await redeem({ token: `spl_${i}` })).status;
    expect(last).toBe(429);
    await env.DB.prepare("DELETE FROM auth_hits").run();
    // Wrong codes anywhere share an allowance of 200; right ones don't spend it.
    const link = await makeLink();
    await env.DB.prepare(
      "INSERT INTO auth_hits (bucket, at) SELECT 'link-code', ? FROM (WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 199) SELECT i FROM n)",
    )
      .bind(Date.now())
      .run();
    expect((await redeem({ code: link.code })).status).toBe(200);
    await env.DB.prepare("DELETE FROM auth_hits WHERE bucket LIKE 'link:%'").run();
    expect((await redeem({ code: "ABCD-EFGH" })).status).toBe(410);
    await env.DB.prepare("DELETE FROM auth_hits WHERE bucket LIKE 'link:%'").run();
    expect((await redeem({ code: "ABCD-EFGH" })).status).toBe(429);
  });
});

describe("inviting someone", () => {
  async function invite(as = cookie) {
    const response = await request("/api/account/invites", { method: "POST", cookie: as });
    expect(response.status).toBe(201);
    const made = await response.json<NewInvite>();
    return { ...made, token: made.url.split("#")[1] ?? "" };
  }
  const join = (json: Record<string, unknown>) => request("/api/join", { method: "POST", json });
  const details = { name: "Mina Park", username: "mina", color: "plum" };

  it("makes a link good for a week, stored hashed, that anyone signed in can see and withdraw", async () => {
    const made = await invite();
    expect(made.url).toMatch(new RegExp(`^${ORIGIN}/join#spi_[A-Za-z0-9_-]{43}$`));
    expect(made.expiresAt - made.createdAt).toBe(7 * 24 * 60 * 60 * 1000);
    expect(JSON.stringify(await env.DB.prepare("SELECT * FROM invites").first())).not.toContain(made.token);
    const sam = await signIn("sam", "battery staple");
    const list = await (await request("/api/account/invites", { cookie: sam })).json<InvitesResponse>();
    expect(list.invites.map((i) => i.id)).toEqual([made.id]);
    expect((await request(`/api/account/invites/${made.id}`, { method: "DELETE", cookie: sam })).status).toBe(204);
    expect((await (await request("/api/account/invites", { cookie })).json<InvitesResponse>()).invites).toEqual([]);
    const peek = await request("/api/join/peek", { method: "POST", json: { token: made.token } });
    expect(peek.status).toBe(410);
  });

  it("tells who invited, then adds one person with a password and signs them in, once", async () => {
    const made = await invite();
    const peek = await (
      await request("/api/join/peek", { method: "POST", json: { token: made.token } })
    ).json<InvitePeek>();
    expect(peek.invitedBy).toBe("Alex Rivera");

    const short = await join({ token: made.token, ...details, password: "short" });
    expect(short.status).toBe(400);
    const joined = await join({ token: made.token, ...details, password: "a long enough password" });
    expect(joined.status).toBe(201);
    expect((await joined.json<SessionResponse>()).user).toMatchObject({
      username: "mina",
      name: "Mina Park",
      color: "plum",
    });
    expect((await request("/api/session", { cookie: cookieOf(joined) })).status).toBe(200);
    expect((await signIn("mina", "a long enough password")).length).toBeGreaterThan(0);
    const people = await (await request("/api/people", { cookie })).json<PeopleResponse>();
    expect(people.people.map((p) => p.username).sort()).toEqual(["alex", "mina", "sam"]);

    const second = await join({ token: made.token, ...details, username: "other", password: "a long enough password" });
    expect(second.status).toBe(410);
    expect((await request("/api/join/peek", { method: "POST", json: { token: made.token } })).status).toBe(410);
    expect((await (await request("/api/account/invites", { cookie })).json<InvitesResponse>()).invites).toEqual([]);
  });

  it("refuses a taken username without using up the invite, a wrong token, an expired and a withdrawn invite", async () => {
    const made = await invite();
    const taken = await join({ token: made.token, ...details, username: "sam", password: "a long enough password" });
    expect(taken.status).toBe(409);
    expect((await join({ token: "spi_nope", ...details, password: "a long enough password" })).status).toBe(410);
    expect(
      (await join({ token: made.token, ...details, username: "Not Valid!", password: "a long enough password" }))
        .status,
    ).toBe(400);
    expect((await join({ token: made.token, ...details })).status).toBe(400);
    expect((await join({ token: made.token, ...details, password: "a long enough password" })).status).toBe(201);

    const old = await invite();
    await env.DB.prepare("UPDATE invites SET expires_at = ? WHERE id = ?")
      .bind(Date.now() - 1, old.id)
      .run();
    expect(
      (await join({ token: old.token, ...details, username: "late", password: "a long enough password" })).status,
    ).toBe(410);

    const withdrawn = await invite();
    await request(`/api/account/invites/${withdrawn.id}`, { method: "DELETE", cookie });
    expect(
      (await join({ token: withdrawn.token, ...details, username: "gone", password: "a long enough password" })).status,
    ).toBe(410);
  });

  it("adds a person with a passkey and no password, and the passkey signs them in", async () => {
    const made = await invite();
    const options = await request("/api/join/options", { method: "POST", json: { token: made.token, ...details } });
    expect(options.status).toBe(200);
    const { ceremonyId, options: creation } =
      await options.json<CeremonyOptions<PublicKeyCredentialCreationOptionsJSON>>();
    const key = new SoftAuthenticator();
    const response = await key.register({ challenge: creation.challenge, rpId: RP, origin: ORIGIN });
    const joined = await join({ token: made.token, ...details, passkey: { ceremonyId, response } });
    expect(joined.status).toBe(201);
    const mina = (await joined.json<SessionResponse>()).user;
    // The passkey belongs to the new person, and the password never matches anything.
    expect(
      (await env.DB.prepare("SELECT user_id FROM passkeys WHERE id = ?").bind(key.id).first<{ user_id: string }>())
        ?.user_id,
    ).toBe(mina.id);
    expect((await request("/api/session", { method: "POST", json: { username: "mina", password: "!" } })).status).toBe(
      401,
    );
    const { ceremonyId: next, options: ask } = await authOptions();
    const assertion = await key.authenticate({
      challenge: ask.challenge,
      rpId: RP,
      origin: ORIGIN,
      userHandle: handle(mina.id),
    });
    expect(
      (await request("/api/session/passkey", { method: "POST", json: { ceremonyId: next, response: assertion } }))
        .status,
    ).toBe(200);
  });

  it("refuses a passkey from another invite's ceremony or the wrong origin, and offers either, not both", async () => {
    const made = await invite();
    const other = await invite();
    const asked = await (
      await request("/api/join/options", { method: "POST", json: { token: other.token, ...details } })
    ).json<CeremonyOptions<PublicKeyCredentialCreationOptionsJSON>>();
    const key = new SoftAuthenticator();
    const answer = await key.register({ challenge: asked.options.challenge, rpId: RP, origin: ORIGIN });
    expect(
      (await join({ token: made.token, ...details, passkey: { ceremonyId: asked.ceremonyId, response: answer } }))
        .status,
    ).toBe(400);

    const mine = await (
      await request("/api/join/options", { method: "POST", json: { token: made.token, ...details } })
    ).json<CeremonyOptions<PublicKeyCredentialCreationOptionsJSON>>();
    const bad = await new SoftAuthenticator().register({
      challenge: mine.options.challenge,
      rpId: RP,
      origin: "https://evil.example",
    });
    expect(
      (await join({ token: made.token, ...details, passkey: { ceremonyId: mine.ceremonyId, response: bad } })).status,
    ).toBe(400);
    expect(
      (
        await join({
          token: made.token,
          ...details,
          password: "a long enough password",
          passkey: { ceremonyId: "x", response: {} },
        })
      ).status,
    ).toBe(400);
    expect((await env.DB.prepare("SELECT count(*) AS n FROM users").first<{ n: number }>())?.n).toBe(2);
    expect(
      (
        await env.DB.prepare("SELECT used_at FROM invites WHERE id = ?")
          .bind(made.id)
          .first<{ used_at: number | null }>()
      )?.used_at,
    ).toBeNull();
  });
});

describe("the devices you are signed in on", () => {
  it("lists them, signs one out, and signs out the rest", async () => {
    const phone = cookieOf(
      await request("/api/session", {
        method: "POST",
        json: { username: "alex", password: "correct horse" },
        headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148 Safari/604.1" },
      }),
    );
    await signIn("sam", "battery staple");
    const list = await (await request("/api/account/devices", { cookie })).json<DevicesResponse>();
    expect(list.devices).toHaveLength(2);
    expect(list.devices.filter((d) => d.current)).toHaveLength(1);
    const other = list.devices.find((d) => !d.current);
    expect(other?.device).toBe("iPhone");
    const current = list.devices.find((d) => d.current);
    expect((await request(`/api/account/devices/${current?.id}`, { method: "DELETE", cookie })).status).toBe(400);
    expect((await request(`/api/account/devices/${other?.id}`, { method: "DELETE", cookie })).status).toBe(204);
    expect((await request("/api/session", { cookie: phone })).status).toBe(401);

    const again = cookieOf(
      await request("/api/session", { method: "POST", json: { username: "alex", password: "correct horse" } }),
    );
    const out = await (await request("/api/account/devices/sign-out-others", { method: "POST", cookie })).json<{
      signedOut: number;
    }>();
    expect(out.signedOut).toBe(1);
    expect((await request("/api/session", { cookie: again })).status).toBe(401);
    expect((await request("/api/session", { cookie })).status).toBe(200);
    // Sam's session is Sam's.
    expect((await env.DB.prepare("SELECT count(*) AS n FROM sessions").first<{ n: number }>())?.n).toBe(2);
  });
});

describe("agent tokens", () => {
  it("can never add passkeys, make or see links, invites or devices, or use the sign-in routes", async () => {
    const made = await request("/api/agents", {
      method: "POST",
      json: { name: "Claude", scopes: ["read", "capture", "attempts", "printer"] },
      cookie,
    });
    const { token } = await made.json<NewTokenResponse>();
    const asAgent = (path: string, method = "GET", json?: unknown) =>
      request(path, { method, json, headers: { Authorization: `Bearer ${token}`, Origin: "http://other.test" } });
    const link = await (await request("/api/account/sign-in-links", { method: "POST", cookie })).json<NewSignInLink>();
    const inv = await (await request("/api/account/invites", { method: "POST", cookie })).json<NewInvite>();
    const { key } = await addPasskey();

    const calls: Array<[string, string, unknown?]> = [
      ["GET", "/api/account/passkeys"],
      ["POST", "/api/account/passkeys/options"],
      ["POST", "/api/account/passkeys", { ceremonyId: "x", response: {} }],
      ["PATCH", `/api/account/passkeys/${key.id}`, { name: "x" }],
      ["DELETE", `/api/account/passkeys/${key.id}`],
      ["POST", "/api/account/sign-in-links"],
      ["GET", `/api/account/sign-in-links/${link.id}`],
      ["DELETE", `/api/account/sign-in-links/${link.id}`],
      ["GET", "/api/account/invites"],
      ["POST", "/api/account/invites"],
      ["DELETE", `/api/account/invites/${inv.id}`],
      ["GET", "/api/account/devices"],
      ["POST", "/api/account/devices/sign-out-others"],
      ["DELETE", "/api/account/devices/anything"],
    ];
    for (const [method, path, json] of calls) {
      const response = await asAgent(path, method, json);
      expect(`${method} ${path} ${response.status}`).toBe(`${method} ${path} 403`);
      expect((await errorOf(response)).code).toBe("person_only");
    }
    // Still all there.
    expect((await env.DB.prepare("SELECT count(*) AS n FROM passkeys").first<{ n: number }>())?.n).toBe(1);
    expect(
      (await env.DB.prepare("SELECT count(*) AS n FROM invites WHERE withdrawn_at IS NULL").first<{ n: number }>())?.n,
    ).toBe(1);
    expect((await env.DB.prepare("SELECT count(*) AS n FROM sign_in_links").first<{ n: number }>())?.n).toBe(1);
    // A token is no sign-in: the session route reads cookies only.
    expect((await asAgent("/api/session")).status).toBe(401);
  });
});
