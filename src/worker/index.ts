import { app } from "./app.ts";
import { resumeCoaches } from "./coach/run.ts";
import { getDb } from "./db/index.ts";
import { resumeDrafts } from "./draft/run.ts";
import { home } from "./home.ts";
import { resumeLabelReads } from "./label-read/run.ts";
import { mcpRoutes } from "./mcp/index.ts";
import { pruneOauth } from "./oauth/grants.ts";
import { oauthEndpoints } from "./oauth/index.ts";
import { resumeReads } from "./photo-read/run.ts";
import { purgeDeleted } from "./photos.ts";
import { sendNudges, sendUpkeepNudge } from "./push/nudges.ts";
import { sendWeekPush } from "./push/week.ts";
import { refreshPrices } from "./shopping/lookup.ts";
import { spa } from "./spa.ts";
import { pruneDeliveries, runWebhooks } from "./webhooks/deliver.ts";

const DAILY = "0 4 * * *";

/**
 * The share target's POST (public/manifest.webmanifest) is answered by the service worker. When it isn't there
 * (a browser that never installed it), the words still arrive: the photos can't be kept, so the page is opened with
 * the title, text and link only. No cookie or CSRF check: it changes nothing, it only redirects.
 */
async function shareFallback(request: Request): Promise<Response> {
  const form = await request.formData().catch(() => null);
  const query = new URLSearchParams();
  for (const name of ["title", "text", "url"]) {
    const value = form?.get(name);
    if (typeof value === "string" && value.trim()) query.set(name, value.slice(0, 20_000));
  }
  return Response.redirect(new URL(`/share${query.size ? `?${query}` : ""}`, request.url).href, 303);
}

export default {
  /**
   * / is the app or the landing page (home.ts); /mcp is the MCP server; everything else is the API (the app's other
   * static files never reach the Worker).
   */
  fetch: (request, env, ctx) => {
    const { pathname } = new URL(request.url);
    if (pathname === "/" && (request.method === "GET" || request.method === "HEAD")) return home(request, env);
    if (pathname === "/mcp") return mcpRoutes.fetch(request, env, ctx);
    if (pathname.startsWith("/.well-known/oauth-") || pathname.startsWith("/oauth/")) {
      return oauthEndpoints.fetch(request, env, ctx);
    }
    if (pathname === "/api/share" && request.method === "POST") return shareFallback(request);
    if (!pathname.startsWith("/api/") && (request.method === "GET" || request.method === "HEAD")) {
      return spa(request, env);
    }
    return app.fetch(request, env, ctx);
  },
  /**
   * Two schedules (triggers in wrangler.jsonc): every 5 minutes the "how did it go?" nudges, and daily
   * the bin of things deleted a month ago.
   */
  async scheduled(controller, env, ctx) {
    if (controller.cron === DAILY) {
      ctx.waitUntil(purgeDeleted(env).then((result) => console.log("purged", result)));
      ctx.waitUntil(pruneOauth(getDb(env.DB)).catch((error) => console.error("oauth tidy failed", error)));
      ctx.waitUntil(pruneDeliveries(env).catch((error) => console.error("webhook tidy failed", error)));
    } else {
      // Webhooks: new changes become deliveries, and what is due (first tries and retries) is sent.
      ctx.waitUntil(
        runWebhooks(env)
          .then((result) => result.made + result.sent + result.failed && console.log("webhooks", result))
          .catch((error) => console.error("webhooks failed", error)),
      );
      ctx.waitUntil(sendNudges(env).then((result) => result.sent && console.log("nudged", result)));
      // Drafts nobody is working on any more (a closed tab, a recycled Worker); a no-op without the key.
      ctx.waitUntil(resumeDrafts(env).catch((error) => console.error("draft resume failed", error)));
      // The gentle daily look at the Prisjakt pages of what's still to buy (decision 0039).
      ctx.waitUntil(refreshPrices(env).catch((error) => console.error("price refresh failed", error)));
      ctx.waitUntil(resumeReads(env).catch((error) => console.error("photo read resume failed", error)));
      ctx.waitUntil(resumeLabelReads(env).catch((error) => console.error("label read resume failed", error)));
      ctx.waitUntil(resumeCoaches(env).catch((error) => console.error("coach resume failed", error)));
      ctx.waitUntil(sendUpkeepNudge(env).then((result) => result.sent && console.log("upkeep nudged", result)));
      // "Your week", Sunday 19:00 in the workspace's time zone (does nothing at any other time).
      ctx.waitUntil(
        sendWeekPush(env)
          .then((result) => result.sent && console.log("week pushed", result))
          .catch((error) => console.error("week push failed", error)),
      );
    }
  },
} satisfies ExportedHandler<Env>;
