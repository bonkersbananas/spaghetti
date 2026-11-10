import { app } from "./app.ts";
import { resumeDrafts } from "./draft/run.ts";
import { mcpRoutes } from "./mcp/index.ts";
import { purgeDeleted } from "./photos.ts";
import { sendNudges, sendUpkeepNudge } from "./push/nudges.ts";

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
  /** /mcp is the MCP server; everything else is the API (the app's static files never reach the Worker). */
  fetch: (request, env, ctx) => {
    const { pathname } = new URL(request.url);
    if (pathname === "/mcp") return mcpRoutes.fetch(request, env, ctx);
    if (pathname === "/api/share" && request.method === "POST") return shareFallback(request);
    return app.fetch(request, env, ctx);
  },
  /**
   * Two schedules (triggers in wrangler.jsonc): every 5 minutes the "how did it go?" nudges, and daily
   * the bin of things deleted a month ago.
   */
  async scheduled(controller, env, ctx) {
    if (controller.cron === DAILY) ctx.waitUntil(purgeDeleted(env).then((result) => console.log("purged", result)));
    else {
      ctx.waitUntil(sendNudges(env).then((result) => result.sent && console.log("nudged", result)));
      // Drafts nobody is working on any more (a closed tab, a recycled Worker); a no-op without the key.
      ctx.waitUntil(resumeDrafts(env).catch((error) => console.error("draft resume failed", error)));
      ctx.waitUntil(sendUpkeepNudge(env).then((result) => result.sent && console.log("upkeep nudged", result)));
    }
  },
} satisfies ExportedHandler<Env>;
