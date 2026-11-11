import {
  type AuthenticatorTransport,
  generateAuthenticationOptions,
  type PublicKeyCredentialRequestOptionsJSON,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import { and, eq, gt, isNull } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { z } from "zod";
import type { SessionResponse } from "../../shared/api.ts";
import { fromBase64Url, toBase64Url } from "../../shared/base64url.ts";
import { verifyPassword } from "../../shared/password.ts";
import {
  type CeremonyOptions,
  deviceName,
  normalizeCode,
  type RedeemSignInLinkRequest,
  type SignInWithPasskeyRequest,
} from "../../shared/signing-in.ts";
import { endSession, readSession, startSession } from "../auth/session.ts";
import {
  clientKey,
  hashSecret,
  hitsIn,
  relyingParty,
  saveChallenge,
  takeChallenge,
  takeHit,
} from "../auth/webauthn.ts";
import { changes, passkeys, pushSubscriptions, signInLinks, users } from "../db/schema.ts";
import type { AppEnv } from "../env.ts";
import { apiError, toPerson } from "../http.ts";

const credentials = z.object({
  username: z.string().trim().toLowerCase().min(1).max(64),
  password: z.string().min(1).max(1024),
});

/**
 * A hash of a throwaway password, checked when the username is unknown so
 * that a wrong username takes as long as a wrong password.
 */
const DUMMY_HASH = "pbkdf2-sha256$100000$c3BhZ2hldHRpLWR1bW15$Zm9yLXRpbWluZy1vbmx5LW5vdC1hLXJlYWwtaGFzaCE=";

/** Wrong codes allowed anywhere in the window, before typed-code sign-in waits. */
const CODE_FAILURES = 200;
const CODE_WINDOW_MS = 10 * 60 * 1000;

const tooMany = (c: Context<AppEnv>) =>
  apiError(c, 429, "rate_limited", "Too many tries. Wait a few minutes and try again.");

export const sessionRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const user = await readSession(c, c.var.db);
    if (!user) return apiError(c, 401, "signed_out", "Not signed in.");
    return c.json<SessionResponse>({ user: toPerson(user) });
  })
  .post("/", async (c) => {
    const parsed = credentials.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return apiError(c, 400, "invalid", "Enter your name and password.");
    const { username, password } = parsed.data;
    const user = await c.var.db.select().from(users).where(eq(users.username, username)).get();
    const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok) {
      return apiError(c, 401, "wrong_credentials", "That name and password don't match.");
    }
    await startSession(c, c.var.db, user.id);
    return c.json<SessionResponse>({ user: toPerson(user) });
  })
  // --- a passkey: the browser asks for options, the person uses Face ID, the browser answers ---
  .post("/passkey/options", async (c) => {
    // Cheap and secret-free (the sign-in screen asks for one on every visit), so the allowance is wide.
    if (!(await takeHit(c, `passkey-options:${clientKey(c)}`, 300))) return tooMany(c);
    const options = await generateAuthenticationOptions({
      rpID: relyingParty(c).rpID,
      userVerification: "required",
    });
    const ceremonyId = await saveChallenge(c, options.challenge, { purpose: "authenticate" });
    return c.json<CeremonyOptions<PublicKeyCredentialRequestOptionsJSON>>({ ceremonyId, options });
  })
  .post("/passkey", async (c) => {
    if (!(await takeHit(c, `passkey:${clientKey(c)}`, 40))) return tooMany(c);
    const body = (await c.req.json().catch(() => null)) as Partial<SignInWithPasskeyRequest> | null;
    const refused = () =>
      apiError(c, 401, "wrong_credentials", "That passkey didn't work. Try again, or use your password.");
    if (!body?.ceremonyId || !body.response || typeof body.response.id !== "string") return refused();
    // The challenge goes first, used or not: every ceremony can be answered once.
    const challenge = await takeChallenge(c, body.ceremonyId, { purpose: "authenticate" });
    if (!challenge) return refused();
    const db = c.var.db;
    const row = await db
      .select({ passkey: passkeys, user: users })
      .from(passkeys)
      .innerJoin(users, eq(users.id, passkeys.userId))
      .where(eq(passkeys.id, body.response.id))
      .get();
    if (!row) return refused();
    // A discoverable passkey says whose it is; it must be this person.
    const handle = body.response.response?.userHandle;
    if (handle && handle !== toBase64Url(new TextEncoder().encode(row.user.id))) return refused();
    const { rpID, origins } = relyingParty(c);
    let verified: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
    try {
      verified = await verifyAuthenticationResponse({
        response: body.response,
        expectedChallenge: challenge.challenge,
        expectedOrigin: origins,
        expectedRPID: rpID,
        requireUserVerification: true,
        credential: {
          id: row.passkey.id,
          publicKey: fromBase64Url(row.passkey.publicKey),
          counter: row.passkey.counter,
          transports: (row.passkey.transports ?? undefined) as AuthenticatorTransport[] | undefined,
        },
      });
    } catch {
      return refused();
    }
    if (!verified.verified) return refused();
    // The counter only goes up (a clone of the key would repeat one); the backup flag follows the key.
    const { newCounter, credentialBackedUp } = verified.authenticationInfo;
    const updated = await db
      .update(passkeys)
      .set({ counter: newCounter, backedUp: credentialBackedUp, lastUsedAt: new Date() })
      .where(and(eq(passkeys.id, row.passkey.id), gt(passkeys.counter, -1)))
      .returning({ id: passkeys.id });
    if (!updated.length) return refused();
    await startSession(c, db, row.user.id);
    return c.json<SessionResponse>({ user: toPerson(row.user) });
  })

  // --- "sign in on another device": the link or the code made on a signed-in one ---
  .post("/link", async (c) => {
    const body = (await c.req.json().catch(() => null)) as RedeemSignInLinkRequest | null;
    const token = typeof body?.token === "string" ? body.token.trim() : "";
    const code = typeof body?.code === "string" ? normalizeCode(body.code) : null;
    const gone = () => apiError(c, 410, "link_gone", "That link has been used or has expired. Ask for a new one.");
    if (!token && !code) {
      return apiError(c, typeof body?.code === "string" ? 400 : 410, "invalid", "That code isn't the right shape.");
    }
    if (!(await takeHit(c, `link:${clientKey(c)}`, 30))) return tooMany(c);
    // A code is short enough to guess at, so wrong ones anywhere count against a shared allowance (spent by
    // failures only, so a right code never uses it up; 200 guesses at 40 bits is nothing, and a script can't
    // spend it faster than one try every three seconds without also being refused per address above).
    if (!token && (await hitsIn(c, "link-code", CODE_WINDOW_MS)) >= CODE_FAILURES) return tooMany(c);
    const hash = await hashSecret(token || (code ?? ""));
    const now = new Date();
    const db = c.var.db;
    const [link] = await db
      .update(signInLinks)
      .set({ usedAt: now, usedOn: deviceName(c.req.header("user-agent")) })
      .where(
        and(
          token ? eq(signInLinks.tokenHash, hash) : eq(signInLinks.codeHash, hash),
          isNull(signInLinks.usedAt),
          gt(signInLinks.expiresAt, now),
        ),
      )
      .returning();
    if (!link) {
      if (!token) await takeHit(c, "link-code", CODE_FAILURES, CODE_WINDOW_MS);
      return gone();
    }
    const user = await db.select().from(users).where(eq(users.id, link.userId)).get();
    if (!user) return gone();
    await db.insert(changes).values({
      entity: "signin",
      entityId: link.id,
      itemId: null,
      action: "updated",
      actorKind: "person",
      actorId: user.id,
      at: now,
    });
    await startSession(c, db, user.id);
    return c.json<SessionResponse>({ user: toPerson(user) });
  })
  .delete("/", async (c) => {
    // A device that signs out stops getting this person's notifications: the app says which one it is.
    const forget = z.object({ pushEndpoint: z.string().max(2048) }).safeParse(await c.req.json().catch(() => null));
    if (forget.success) {
      const user = await readSession(c, c.var.db);
      if (user) {
        await c.var.db
          .delete(pushSubscriptions)
          .where(and(eq(pushSubscriptions.endpoint, forget.data.pushEndpoint), eq(pushSubscriptions.userId, user.id)));
      }
    }
    await endSession(c, c.var.db);
    return c.body(null, 204);
  });
