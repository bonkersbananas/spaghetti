import { Hono } from "hono";
import { csrf } from "hono/csrf";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import { bearerToken, readAgentToken } from "./auth/agent.ts";
import { needsFor, scopeList } from "./auth/scopes.ts";
import { readSession } from "./auth/session.ts";
import { actorOf } from "./changes.ts";
import { getDb } from "./db/index.ts";
import type { AppEnv } from "./env.ts";
import { apiError } from "./http.ts";
import { accountRoutes } from "./routes/account.ts";
import { agentRoutes } from "./routes/agents.ts";
import { attemptRoutes, itemAttemptRoutes } from "./routes/attempts.ts";
import { captureRoutes } from "./routes/capture.ts";
import { changeRoutes } from "./routes/changes.ts";
import { draftRoutes } from "./routes/drafts.ts";
import { attemptFileRoutes, fileRoutes } from "./routes/files.ts";
import { itemRoutes } from "./routes/items.ts";
import { journalRoutes } from "./routes/journal.ts";
import { linkRoutes } from "./routes/links.ts";
import { peopleRoutes } from "./routes/people.ts";
import { photoRoutes } from "./routes/photos.ts";
import { printerRoutes } from "./routes/printer.ts";
import { pushRoutes } from "./routes/push.ts";
import { recipeRoutes } from "./routes/recipes.ts";
import { searchRoutes } from "./routes/search.ts";
import { sessionRoutes } from "./routes/session.ts";
import { spoolRoutes } from "./routes/spools.ts";
import { storyRoutes } from "./routes/story.ts";
import { tagRoutes } from "./routes/tags.ts";

/**
 * Everything under /api except signing in needs a person's session or an
 * agent's bearer token. With an Authorization header only the token counts
 * (an invalid one is refused, never retried as the cookie).
 */
const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const token = bearerToken(c);
  if (token !== undefined) {
    const agent = token ? await readAgentToken(c.var.db, token) : null;
    if (!agent) return apiError(c, 401, "invalid_token", "That token isn't valid, or it was revoked.");
    c.set("user", agent.user);
    c.set("actor", { kind: "agent", id: agent.agentId });
    c.set("via", agent.agentId);
    c.set("scopes", agent.scopes);
    return next();
  }
  const user = await readSession(c, c.var.db);
  if (!user) return apiError(c, 401, "signed_out", "Not signed in.");
  c.set("user", user);
  c.set("actor", actorOf(user));
  c.set("via", null);
  c.set("scopes", null);
  await next();
});

/** A token only goes where its scopes say (see auth/scopes.ts). */
const requireScope = createMiddleware<AppEnv>(async (c, next) => {
  const scopes = c.var.scopes;
  if (scopes) {
    const needs = needsFor(c.req.method, c.req.path.replace(/^\/api/, "") || "/");
    if (needs === "person") {
      return apiError(c, 403, "person_only", "Only a signed-in person can do that, not an agent.");
    }
    if (!needs.some((scope) => scopes.includes(scope))) {
      return apiError(c, 403, "missing_scope", `This token needs the ${scopeList(needs)} scope for that.`);
    }
  }
  await next();
});

/** A token isn't a cookie: nothing a browser sends on its own can carry one, so it needs no CSRF check. */
const csrfCheck = csrf();
const csrfUnlessToken = createMiddleware<AppEnv>(async (c, next) =>
  c.req.header("authorization") === undefined ? csrfCheck(c, next) : next(),
);

export const app = new Hono<AppEnv>()
  .basePath("/api")
  .use(secureHeaders())
  // Rejects cross-site form posts; the cookie is SameSite=Lax as well.
  .use(csrfUnlessToken)
  .use(async (c, next) => {
    c.set("db", getDb(c.env.DB));
    c.header("Cache-Control", "no-store");
    await next();
  })
  .get("/health", (c) => c.json({ ok: true }))
  .route("/session", sessionRoutes)
  .use(requireAuth)
  .use(requireScope)
  .route("/account", accountRoutes)
  .route("/push", pushRoutes)
  .route("/people", peopleRoutes)
  .route("/agents", agentRoutes)
  .route("/changes", changeRoutes)
  .route("/capture", captureRoutes)
  .route("/", draftRoutes)
  .route("/items", itemRoutes)
  .route("/items", itemAttemptRoutes)
  .route("/attempts", attemptRoutes)
  .route("/attempts", attemptFileRoutes)
  .route("/files", fileRoutes)
  .route("/spools", spoolRoutes)
  .route("/recipes", recipeRoutes)
  .route("/printer", printerRoutes)
  .route("/photos", photoRoutes)
  .route("/tags", tagRoutes)
  .route("/journal", journalRoutes)
  .route("/links", linkRoutes)
  .route("/builds", storyRoutes)
  .route("/", searchRoutes)
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
