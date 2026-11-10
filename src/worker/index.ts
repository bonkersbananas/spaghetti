import { app } from "./app.ts";
import { mcpRoutes } from "./mcp/index.ts";
import { purgeDeleted } from "./photos.ts";
import { sendNudges } from "./push/nudges.ts";

const DAILY = "0 4 * * *";

export default {
  /** /mcp is the MCP server; everything else is the API (the app's static files never reach the Worker). */
  fetch: (request, env, ctx) =>
    new URL(request.url).pathname === "/mcp" ? mcpRoutes.fetch(request, env, ctx) : app.fetch(request, env, ctx),
  /**
   * Two schedules (triggers in wrangler.jsonc): every 5 minutes the "how did it go?" nudges, and daily
   * the bin of things deleted a month ago.
   */
  async scheduled(controller, env, ctx) {
    if (controller.cron === DAILY) ctx.waitUntil(purgeDeleted(env).then((result) => console.log("purged", result)));
    else ctx.waitUntil(sendNudges(env).then((result) => result.sent && console.log("nudged", result)));
  },
} satisfies ExportedHandler<Env>;
