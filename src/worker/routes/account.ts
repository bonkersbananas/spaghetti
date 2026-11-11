import { and, eq, ne } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { type ChangePasswordResponse, MIN_PASSWORD_LENGTH } from "../../shared/api.ts";
import { hashPassword, verifyPassword } from "../../shared/password.ts";
import { currentSessionId } from "../auth/session.ts";
import { passwordFailures, sessions, users } from "../db/schema.ts";
import type { AppEnv } from "../env.ts";
import { apiError } from "../http.ts";

/** Five wrong current passwords in a quarter of an hour, and the person waits. */
export const PASSWORD_ATTEMPTS = 5;
export const PASSWORD_WINDOW_MS = 15 * 60 * 1000;

const body = z.object({
  currentPassword: z.string().min(1).max(1024),
  newPassword: z.string().max(1024),
});

/**
 * Your own account. Person-only: it is not in auth/scopes.ts, so a token is refused with person_only.
 */
export const accountRoutes = new Hono<AppEnv>().put("/password", async (c) => {
  const parsed = body.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return apiError(c, 400, "invalid", "Enter your current and your new password.");
  const { currentPassword, newPassword } = parsed.data;
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return apiError(c, 400, "too_short", `Use at least ${MIN_PASSWORD_LENGTH} characters.`);
  }

  const db = c.var.db;
  const user = c.var.user;
  // Each try is recorded before the slow check, in one statement that refuses once the window is full,
  // so parallel guesses can't all read a low count first. A right password clears them below.
  const now = Date.now();
  const taken = await c.env.DB.prepare(
    `INSERT INTO password_failures (user_id, at)
     SELECT ?1, ?2 WHERE (SELECT count(*) FROM password_failures WHERE user_id = ?1 AND at > ?3) < ?4`,
  )
    .bind(user.id, now, now - PASSWORD_WINDOW_MS, PASSWORD_ATTEMPTS)
    .run();
  if (!taken.meta.changes) {
    return apiError(c, 429, "rate_limited", "Too many wrong passwords. Try again in a few minutes.");
  }

  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    return apiError(c, 403, "wrong_password", "That isn't your current password.");
  }
  if (newPassword === currentPassword) {
    return apiError(c, 400, "same_password", "That's the password you already have. Pick a new one.");
  }

  const keep = await currentSessionId(c);
  const others = await db.batch([
    db
      .update(users)
      .set({ passwordHash: await hashPassword(newPassword) })
      .where(eq(users.id, user.id)),
    db.delete(passwordFailures).where(eq(passwordFailures.userId, user.id)),
    db
      .delete(sessions)
      .where(keep ? and(eq(sessions.userId, user.id), ne(sessions.id, keep)) : eq(sessions.userId, user.id))
      .returning({ id: sessions.id }),
  ]);
  return c.json<ChangePasswordResponse>({ signedOut: others[2].length });
});

/** For the OpenAPI document (worker/openapi). */
export { body as changePasswordBody };
