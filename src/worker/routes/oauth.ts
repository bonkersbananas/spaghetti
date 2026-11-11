import { Hono } from "hono";
import { z } from "zod";
import type { AuthorizeRequestInfo } from "../../shared/oauth.ts";
import type { AppEnv } from "../env.ts";
import { apiError } from "../http.ts";
import { authorizeParams, checkAuthorizeRequest, issueCode, returnTo } from "../oauth/authorize.ts";

const decision = authorizeParams.extend({ approve: z.boolean() });

/**
 * The consent screen's two calls, for a signed-in person only (the guard in app.ts refuses tokens): what is asked,
 * and the answer. The protocol's own endpoints are in worker/oauth/index.ts.
 */
export const oauthRoutes = new Hono<AppEnv>()
  .get("/request", async (c) => {
    const checked = await checkAuthorizeRequest(c.var.db, new URL(c.req.url).origin, c.req.query());
    if (!checked.ok) return apiError(c, 400, checked.error, checked.description);
    return c.json<AuthorizeRequestInfo>({
      app: checked.client.name,
      returnsTo: new URL(checked.params.redirect_uri).host || new URL(checked.params.redirect_uri).protocol,
      scopes: checked.scopes,
    });
  })
  .post("/decision", async (c) => {
    const body = await c.req.json().catch(() => null);
    const origin = new URL(c.req.url).origin;
    const checked = await checkAuthorizeRequest(c.var.db, origin, body);
    const answer = decision.safeParse(body);
    if (!checked.ok || !answer.success) {
      return apiError(
        c,
        400,
        checked.ok ? "invalid_request" : checked.error,
        checked.ok ? "Approve or decline." : checked.description,
      );
    }
    if (!answer.data.approve) {
      return c.json({ redirectTo: returnTo(checked.params, origin, { error: "access_denied" }) });
    }
    const code = await issueCode(c.var.db, c.var.user.id, checked);
    return c.json({ redirectTo: returnTo(checked.params, origin, { code }) });
  });
