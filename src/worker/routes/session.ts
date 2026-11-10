import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { SessionResponse } from "../../shared/api.ts";
import { verifyPassword } from "../../shared/password.ts";
import { endSession, readSession, startSession } from "../auth/session.ts";
import { pushSubscriptions, users } from "../db/schema.ts";
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
