import { Hono } from "hono";
import { csrf } from "hono/csrf";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import { readSession } from "./auth/session.ts";
import { getDb } from "./db/index.ts";
import type { AppEnv } from "./env.ts";
import { apiError } from "./http.ts";
import { itemRoutes } from "./routes/items.ts";
import { peopleRoutes } from "./routes/people.ts";
import { photoRoutes } from "./routes/photos.ts";
import { sessionRoutes } from "./routes/session.ts";

/** Everything under /api except signing in needs a session. */
const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  const user = await readSession(c, c.var.db);
  if (!user) return apiError(c, 401, "signed_out", "Not signed in.");
  c.set("user", user);
  await next();
});

export const app = new Hono<AppEnv>()
  .basePath("/api")
  .use(secureHeaders())
  // Rejects cross-site form posts; the cookie is SameSite=Lax as well.
  .use(csrf())
  .use(async (c, next) => {
    c.set("db", getDb(c.env.DB));
    c.header("Cache-Control", "no-store");
    await next();
  })
  .get("/health", (c) => c.json({ ok: true }))
  .route("/session", sessionRoutes)
  .use(requireUser)
  .route("/people", peopleRoutes)
  .route("/items", itemRoutes)
  .route("/photos", photoRoutes)
  .notFound((c) => apiError(c, 404, "not_found", "No such endpoint."))
  .onError((err, c) => {
    if (err instanceof HTTPException) {
      // Expected refusals, such as the CSRF check: keep their status.
      return apiError(c, err.status, "refused", err.message || "Request refused.");
    }
    console.error(err);
    return apiError(c, 500, "server_error", "Something went wrong on our side.");
  });

export type App = typeof app;
