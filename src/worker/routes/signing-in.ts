import {
  generateRegistrationOptions,
  type PublicKeyCredentialCreationOptionsJSON,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { and, asc, desc, eq, gt, isNull, ne } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { toBase64Url } from "../../shared/base64url.ts";
import {
  type AddPasskeyRequest,
  type CeremonyOptions,
  CODE_ALPHABET,
  CODE_LENGTH,
  type DevicesResponse,
  deviceName,
  formatCode,
  INVITE_TTL_MS,
  type InviteInfo,
  type InvitesResponse,
  MAX_PASSKEY_NAME,
  type NewInvite,
  type NewSignInLink,
  type PasskeyInfo,
  type PasskeysResponse,
  SIGN_IN_LINK_TTL_MS,
  type SignInLinkInfo,
} from "../../shared/signing-in.ts";
import { currentSessionId } from "../auth/session.ts";
import { hashSecret, RP_NAME, relyingParty, saveChallenge, takeChallenge, takeHit } from "../auth/webauthn.ts";
import { recordChange } from "../changes.ts";
import { type Invite, invites, type Passkey, passkeys, type SignInLink, sessions, signInLinks } from "../db/schema.ts";
import type { AppEnv } from "../env.ts";
import { apiError } from "../http.ts";

/** A person keeps this many passkeys at most (a phone, a laptop and a few spares). */
const MAX_PASSKEYS = 12;
/** Links and invites someone may have waiting at once: they can only withdraw the rest. */
const MAX_WAITING = 10;

export const toPasskeyInfo = (row: Passkey): PasskeyInfo => ({
  id: row.id,
  name: row.name,
  createdAt: row.createdAt.getTime(),
  lastUsedAt: row.lastUsedAt?.getTime() ?? null,
  backedUp: row.backedUp,
});

const toLinkInfo = (row: SignInLink): SignInLinkInfo => ({
  id: row.id,
  createdAt: row.createdAt.getTime(),
  expiresAt: row.expiresAt.getTime(),
  usedOn: row.usedOn,
  usedAt: row.usedAt?.getTime() ?? null,
});

const toInviteInfo = (row: Invite): InviteInfo => ({
  id: row.id,
  createdAt: row.createdAt.getTime(),
  expiresAt: row.expiresAt.getTime(),
  createdBy: row.createdBy,
});

/** A token: a prefix that says what it is, and 32 random bytes. Shown once; only its hash is kept. */
const makeToken = (prefix: string) => `${prefix}${toBase64Url(crypto.getRandomValues(new Uint8Array(32)))}`;

/** A short code to type: CODE_LENGTH letters and digits that are easy to tell apart. */
function makeCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  // 256 isn't a multiple of 31: dropping the top few values keeps every character equally likely.
  const limit = 256 - (256 % CODE_ALPHABET.length);
  let code = "";
  for (let i = 0; code.length < CODE_LENGTH; i++) {
    const byte = i < bytes.length ? (bytes[i] ?? 0) : (crypto.getRandomValues(new Uint8Array(1))[0] ?? 0);
    if (byte < limit) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  }
  return code;
}

const passkeyName = z.string().trim().min(1).max(MAX_PASSKEY_NAME);

/**
 * Everything about how you sign in: passkeys, links to sign in on another device, invites and the devices
 * you are signed in on. Mounted at /account, so for tokens it is person-only (auth/scopes.ts: nothing here is
 * listed, and reading /account is person-only too).
 */
export const signingInRoutes = new Hono<AppEnv>()
  // --- passkeys ---
  .get("/passkeys", async (c) => {
    const rows = await c.var.db
      .select()
      .from(passkeys)
      .where(eq(passkeys.userId, c.var.user.id))
      .orderBy(asc(passkeys.createdAt));
    return c.json<PasskeysResponse>({ passkeys: rows.map(toPasskeyInfo) });
  })

  .post("/passkeys/options", async (c) => {
    const user = c.var.user;
    const existing = await c.var.db.select({ id: passkeys.id }).from(passkeys).where(eq(passkeys.userId, user.id));
    if (existing.length >= MAX_PASSKEYS)
      return apiError(c, 409, "too_many", "That's plenty of passkeys. Remove one first.");
    const { rpID } = relyingParty(c);
    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID,
      userName: user.username,
      userDisplayName: user.name,
      userID: new Uint8Array(new TextEncoder().encode(user.id)),
      attestationType: "none",
      excludeCredentials: existing.map((passkey) => ({ id: passkey.id })),
      // Face ID, Touch ID or a PIN, every time, and a passkey that can sign in without typing a name.
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
    });
    const ceremonyId = await saveChallenge(c, options.challenge, { purpose: "register", userId: user.id });
    return c.json<CeremonyOptions<PublicKeyCredentialCreationOptionsJSON>>({ ceremonyId, options });
  })

  .post("/passkeys", async (c) => {
    const body = (await c.req.json().catch(() => null)) as Partial<AddPasskeyRequest> | null;
    if (!body?.ceremonyId || !body.response) return apiError(c, 400, "invalid", "That passkey couldn't be read.");
    const user = c.var.user;
    const challenge = await takeChallenge(c, body.ceremonyId, { purpose: "register", userId: user.id });
    if (!challenge) return apiError(c, 400, "expired", "That took too long. Try again.");
    const { rpID, origins } = relyingParty(c);
    let verified: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
    try {
      verified = await verifyRegistrationResponse({
        response: body.response,
        expectedChallenge: challenge.challenge,
        expectedOrigin: origins,
        expectedRPID: rpID,
        requireUserVerification: true,
      });
    } catch {
      return apiError(c, 400, "not_verified", "That passkey couldn't be verified.");
    }
    if (!verified.verified) return apiError(c, 400, "not_verified", "That passkey couldn't be verified.");
    const { credential, credentialDeviceType, credentialBackedUp } = verified.registrationInfo;
    const row: Passkey = {
      id: credential.id,
      userId: user.id,
      publicKey: toBase64Url(credential.publicKey),
      counter: credential.counter,
      transports: credential.transports ?? null,
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      name: deviceName(c.req.header("user-agent")),
      createdAt: new Date(),
      lastUsedAt: null,
    };
    const db = c.var.db;
    const taken = await db.select({ id: passkeys.id }).from(passkeys).where(eq(passkeys.id, row.id)).get();
    if (taken) return apiError(c, 409, "exists", "That device already has a passkey.");
    await db.batch([
      db.insert(passkeys).values(row),
      recordChange(db, { entity: "passkey", id: row.id, action: "created", actor: c.var.actor }),
    ]);
    return c.json<PasskeyInfo>(toPasskeyInfo(row), 201);
  })

  .patch("/passkeys/:id", async (c) => {
    const parsed = z.object({ name: passkeyName }).safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return apiError(c, 400, "invalid", "Give it a short name.");
    const db = c.var.db;
    const id = c.req.param("id");
    const [updated] = await db.batch([
      db
        .update(passkeys)
        .set({ name: parsed.data.name })
        .where(and(eq(passkeys.id, id), eq(passkeys.userId, c.var.user.id)))
        .returning(),
      recordChange(db, { entity: "passkey", id, action: "updated", actor: c.var.actor }),
    ]);
    const row = updated[0];
    if (!row) return apiError(c, 404, "not_found", "No such passkey.");
    return c.json<PasskeyInfo>(toPasskeyInfo(row));
  })

  .delete("/passkeys/:id", async (c) => {
    const db = c.var.db;
    const id = c.req.param("id");
    await db.batch([
      db.delete(passkeys).where(and(eq(passkeys.id, id), eq(passkeys.userId, c.var.user.id))),
      recordChange(db, { entity: "passkey", id, action: "deleted", actor: c.var.actor }),
    ]);
    return c.body(null, 204);
  })

  // --- sign in on another device ---
  .post("/sign-in-links", async (c) => {
    const db = c.var.db;
    const user = c.var.user;
    const now = Date.now();
    if (!(await takeHit(c, `make-link:${user.id}`, 20))) {
      return apiError(c, 429, "rate_limited", "That's a lot of links. Try again in a few minutes.");
    }
    // A person has one waiting at a time: a new one replaces any that were still unused.
    await db.delete(signInLinks).where(and(eq(signInLinks.userId, user.id), isNull(signInLinks.usedAt)));
    const token = makeToken("spl_");
    const code = makeCode();
    const row: SignInLink = {
      id: crypto.randomUUID(),
      userId: user.id,
      tokenHash: await hashSecret(token),
      codeHash: await hashSecret(code),
      createdAt: new Date(now),
      expiresAt: new Date(now + SIGN_IN_LINK_TTL_MS),
      usedAt: null,
      usedOn: null,
    };
    await db.insert(signInLinks).values(row);
    return c.json<NewSignInLink>(
      { ...toLinkInfo(row), url: `${new URL(c.req.url).origin}/link#${token}`, code: formatCode(code) },
      201,
    );
  })

  .get("/sign-in-links/:id", async (c) => {
    const row = await c.var.db
      .select()
      .from(signInLinks)
      .where(and(eq(signInLinks.id, c.req.param("id")), eq(signInLinks.userId, c.var.user.id)))
      .get();
    if (!row) return apiError(c, 404, "not_found", "No such link.");
    return c.json<SignInLinkInfo>(toLinkInfo(row));
  })

  .delete("/sign-in-links/:id", async (c) => {
    await c.var.db
      .delete(signInLinks)
      .where(
        and(eq(signInLinks.id, c.req.param("id")), eq(signInLinks.userId, c.var.user.id), isNull(signInLinks.usedAt)),
      );
    return c.body(null, 204);
  })

  // --- invites ---
  .get("/invites", async (c) => {
    const rows = await c.var.db
      .select()
      .from(invites)
      .where(and(isNull(invites.usedAt), isNull(invites.withdrawnAt), gt(invites.expiresAt, new Date())))
      .orderBy(desc(invites.createdAt));
    return c.json<InvitesResponse>({ invites: rows.map(toInviteInfo) });
  })

  .post("/invites", async (c) => {
    const db = c.var.db;
    const user = c.var.user;
    const now = Date.now();
    const waiting = await db
      .select({ id: invites.id })
      .from(invites)
      .where(and(isNull(invites.usedAt), isNull(invites.withdrawnAt), gt(invites.expiresAt, new Date(now))));
    if (waiting.length >= MAX_WAITING) {
      return apiError(c, 409, "too_many", "Withdraw an invite you don't need before making another.");
    }
    const token = makeToken("spi_");
    const row: Invite = {
      id: crypto.randomUUID(),
      tokenHash: await hashSecret(token),
      createdBy: user.id,
      createdAt: new Date(now),
      expiresAt: new Date(now + INVITE_TTL_MS),
      usedAt: null,
      usedBy: null,
      withdrawnAt: null,
    };
    await db.batch([
      db.insert(invites).values(row),
      recordChange(db, { entity: "invite", id: row.id, action: "created", actor: c.var.actor }),
    ]);
    return c.json<NewInvite>({ ...toInviteInfo(row), url: `${new URL(c.req.url).origin}/join#${token}` }, 201);
  })

  .delete("/invites/:id", async (c) => {
    const db = c.var.db;
    const id = c.req.param("id");
    await db.batch([
      db
        .update(invites)
        .set({ withdrawnAt: new Date() })
        .where(and(eq(invites.id, id), isNull(invites.usedAt), isNull(invites.withdrawnAt))),
      recordChange(db, { entity: "invite", id, action: "deleted", actor: c.var.actor }),
    ]);
    return c.body(null, 204);
  })

  // --- the devices you are signed in on ---
  .get("/devices", async (c) => {
    const rows = await c.var.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.userId, c.var.user.id), gt(sessions.expiresAt, new Date())))
      .orderBy(desc(sessions.lastSeenAt));
    const mine = await currentSessionId(c);
    return c.json<DevicesResponse>({
      devices: rows.map((row) => ({
        id: row.id,
        device: deviceName(row.userAgent),
        createdAt: row.createdAt.getTime(),
        lastSeenAt: row.lastSeenAt.getTime(),
        current: row.id === mine,
      })),
    });
  })

  .post("/devices/sign-out-others", async (c) => {
    const keep = await currentSessionId(c);
    const gone = await c.var.db
      .delete(sessions)
      .where(keep ? and(eq(sessions.userId, c.var.user.id), ne(sessions.id, keep)) : eq(sessions.userId, c.var.user.id))
      .returning({ id: sessions.id });
    return c.json({ signedOut: gone.length });
  })

  .delete("/devices/:id", async (c) => {
    const id = c.req.param("id");
    if (id === (await currentSessionId(c))) return apiError(c, 400, "current", "That's this device: use Sign out.");
    await c.var.db.delete(sessions).where(and(eq(sessions.id, id), eq(sessions.userId, c.var.user.id)));
    return c.body(null, 204);
  });
