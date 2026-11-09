import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Db } from "../db/index.ts";
import { sessions, type User, users } from "../db/schema.ts";

export const SESSION_COOKIE = "spaghetti_session";
/** Browsers cap cookie lifetimes at 400 days; a phone stays signed in that long. */
const SESSION_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;
/** Each day of use extends the session again, so it only lapses after 400 idle days. */
const RENEW_AFTER_MS = 24 * 60 * 60 * 1000;

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function writeCookie(c: Context, token: string) {
  setCookie(c, SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    // Secure on https; plain http only reaches the app on a local network.
    secure: new URL(c.req.url).protocol === "https:",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function startSession(c: Context, db: Db, userId: string) {
  const token = randomToken();
  const now = new Date();
  await db.insert(sessions).values({
    id: await hashToken(token),
    userId,
    createdAt: now,
    lastSeenAt: now,
    expiresAt: new Date(now.getTime() + SESSION_MAX_AGE_SECONDS * 1000),
    userAgent: c.req.header("user-agent")?.slice(0, 255) ?? null,
  });
  writeCookie(c, token);
}

/** Returns the signed-in user, renewing the session at most once a day. */
export async function readSession(c: Context, db: Db): Promise<User | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  const id = await hashToken(token);
  const row = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, id))
    .get();
  if (!row) return null;

  const now = Date.now();
  if (row.session.expiresAt.getTime() <= now) {
    await db.delete(sessions).where(eq(sessions.id, id));
    return null;
  }
  if (now - row.session.lastSeenAt.getTime() > RENEW_AFTER_MS) {
    await db
      .update(sessions)
      .set({
        lastSeenAt: new Date(now),
        expiresAt: new Date(now + SESSION_MAX_AGE_SECONDS * 1000),
      })
      .where(eq(sessions.id, id));
    writeCookie(c, token);
  }
  return row.user;
}

export async function endSession(c: Context, db: Db) {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await db.delete(sessions).where(eq(sessions.id, await hashToken(token)));
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}
