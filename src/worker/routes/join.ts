import {
  generateRegistrationOptions,
  type PublicKeyCredentialCreationOptionsJSON,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { and, eq, gt, isNull } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { MIN_PASSWORD_LENGTH, type SessionResponse } from "../../shared/api.ts";
import { toBase64Url } from "../../shared/base64url.ts";
import { hashPassword } from "../../shared/password.ts";
import { PERSON_COLORS, USERNAME_PATTERN } from "../../shared/people.ts";
import { type CeremonyOptions, deviceName, type InvitePeek } from "../../shared/signing-in.ts";
import { startSession } from "../auth/session.ts";
import {
  clientKey,
  hashSecret,
  RP_NAME,
  relyingParty,
  saveChallenge,
  takeChallenge,
  takeHit,
} from "../auth/webauthn.ts";
import { changes, type Invite, invites, passkeys, users } from "../db/schema.ts";
import type { AppEnv } from "../env.ts";
import { apiError, toPerson } from "../http.ts";

/** A person who joined with a passkey only has no password: this never verifies as one (shared/password.ts). */
export const NO_PASSWORD = "!";

const details = z.object({
  token: z.string().min(1).max(200),
  name: z.string().trim().min(1).max(64),
  username: z.string().trim().toLowerCase().regex(USERNAME_PATTERN),
  color: z.enum(PERSON_COLORS),
});
const join = details.extend({
  password: z.string().max(1024).optional(),
  passkey: z.object({ ceremonyId: z.string().max(100), response: z.any() }).optional(),
});

const gone = (c: Context<AppEnv>) =>
  apiError(c, 410, "invite_gone", "This invite has been used, withdrawn or has expired. Ask for a new one.");
const tooMany = (c: Context<AppEnv>) =>
  apiError(c, 429, "rate_limited", "Too many tries. Wait a few minutes and try again.");

/** The invite a token opens, if it still can be used. */
async function openInvite(c: Context<AppEnv>, token: string): Promise<Invite | null> {
  const row = await c.var.db
    .select()
    .from(invites)
    .where(
      and(
        eq(invites.tokenHash, await hashSecret(token)),
        isNull(invites.usedAt),
        isNull(invites.withdrawnAt),
        gt(invites.expiresAt, new Date()),
      ),
    )
    .get();
  return row ?? null;
}

/**
 * Joining by invite. Public (nobody is signed in yet), so everything is rate limited and a token is the only
 * way in: the token is checked at every step, and `/join` itself claims the invite once, atomically.
 */
export const joinRoutes = new Hono<AppEnv>()
  .post("/peek", async (c) => {
    if (!(await takeHit(c, `join:${clientKey(c)}`, 30))) return tooMany(c);
    const parsed = z.object({ token: z.string().min(1).max(200) }).safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return gone(c);
    const invite = await openInvite(c, parsed.data.token);
    if (!invite) return gone(c);
    const host = await c.var.db.select().from(users).where(eq(users.id, invite.createdBy)).get();
    return c.json<InvitePeek>({ invitedBy: host?.name ?? "Someone", expiresAt: invite.expiresAt.getTime() });
  })

  .post("/options", async (c) => {
    if (!(await takeHit(c, `join:${clientKey(c)}`, 30))) return tooMany(c);
    const parsed = details.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return apiError(c, 400, "invalid", "Fill in a name and a username first.");
    const invite = await openInvite(c, parsed.data.token);
    if (!invite) return gone(c);
    if (await c.var.db.select({ id: users.id }).from(users).where(eq(users.username, parsed.data.username)).get()) {
      return apiError(c, 409, "username_taken", "Someone already uses that username.");
    }
    // The new person's id is chosen now, so the passkey is made for them and no one else.
    const userId = crypto.randomUUID();
    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: relyingParty(c).rpID,
      userName: parsed.data.username,
      userDisplayName: parsed.data.name,
      userID: new Uint8Array(new TextEncoder().encode(userId)),
      attestationType: "none",
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
    });
    const ceremonyId = await saveChallenge(c, options.challenge, { purpose: "invite", userId, inviteId: invite.id });
    return c.json<CeremonyOptions<PublicKeyCredentialCreationOptionsJSON>>({ ceremonyId, options });
  })

  .post("/", async (c) => {
    if (!(await takeHit(c, `join:${clientKey(c)}`, 30))) return tooMany(c);
    const parsed = join.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return apiError(c, 400, "invalid", "Fill in a name, a username and a password or passkey.");
    const { token, name, username, color, password, passkey } = parsed.data;
    if (!password === !passkey) {
      return apiError(c, 400, "invalid", "Choose a password or a passkey.");
    }
    if (password !== undefined && password.length < MIN_PASSWORD_LENGTH) {
      return apiError(c, 400, "too_short", `Use at least ${MIN_PASSWORD_LENGTH} characters.`);
    }
    const db = c.var.db;
    const invite = await openInvite(c, token);
    if (!invite) return gone(c);
    if (await db.select({ id: users.id }).from(users).where(eq(users.username, username)).get()) {
      return apiError(c, 409, "username_taken", "Someone already uses that username.");
    }

    let userId = crypto.randomUUID();
    let credential: typeof passkeys.$inferInsert | null = null;
    if (passkey) {
      const challenge = await takeChallenge(c, passkey.ceremonyId, { purpose: "invite", inviteId: invite.id });
      if (!challenge?.userId) return apiError(c, 400, "expired", "That took too long. Try again.");
      userId = challenge.userId;
      const { rpID, origins } = relyingParty(c);
      try {
        const verified = await verifyRegistrationResponse({
          response: passkey.response,
          expectedChallenge: challenge.challenge,
          expectedOrigin: origins,
          expectedRPID: rpID,
          requireUserVerification: true,
        });
        if (!verified.verified) throw new Error("not verified");
        const info = verified.registrationInfo;
        credential = {
          id: info.credential.id,
          userId,
          publicKey: toBase64Url(info.credential.publicKey),
          counter: info.credential.counter,
          transports: info.credential.transports ?? null,
          deviceType: info.credentialDeviceType,
          backedUp: info.credentialBackedUp,
          name: deviceName(c.req.header("user-agent")),
          createdAt: new Date(),
          lastUsedAt: null,
        };
      } catch {
        return apiError(c, 400, "not_verified", "That passkey couldn't be verified.");
      }
    }

    // Claim the invite first, in one statement: of two people opening one link, only one gets past here.
    const now = new Date();
    const [claimed] = await db
      .update(invites)
      .set({ usedAt: now, usedBy: userId })
      .where(
        and(eq(invites.id, invite.id), isNull(invites.usedAt), isNull(invites.withdrawnAt), gt(invites.expiresAt, now)),
      )
      .returning({ id: invites.id });
    if (!claimed) return gone(c);

    const passwordHash = password !== undefined ? await hashPassword(password) : NO_PASSWORD;
    try {
      await db.batch([
        db.insert(users).values({ id: userId, username, name, color, passwordHash, createdAt: now }),
        ...(credential ? [db.insert(passkeys).values(credential)] : []),
        db.insert(changes).values({
          entity: "person",
          entityId: userId,
          itemId: null,
          action: "created",
          actorKind: "person",
          actorId: userId,
          at: now,
        }),
      ]);
    } catch {
      // The username or passkey was taken in the meantime: the invite is still good.
      await db.update(invites).set({ usedAt: null, usedBy: null }).where(eq(invites.id, invite.id));
      return apiError(c, 409, "username_taken", "That username or passkey is already taken.");
    }
    await startSession(c, db, userId);
    const user = await db.select().from(users).where(eq(users.id, userId)).get();
    if (!user) return apiError(c, 500, "server_error", "Something went wrong on our side.");
    return c.json<SessionResponse>({ user: toPerson(user) }, 201);
  });
