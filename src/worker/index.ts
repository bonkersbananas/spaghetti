import { app } from "./app.ts";
import { mcpRoutes } from "./mcp/index.ts";
import { purgeDeleted } from "./photos.ts";

export default {
  /** /mcp is the MCP server; everything else is the API (the app's static files never reach the Worker). */
  fetch: (request, env, ctx) =>
    new URL(request.url).pathname === "/mcp" ? mcpRoutes.fetch(request, env, ctx) : app.fetch(request, env, ctx),
  /** Daily (see triggers in wrangler.jsonc): empties the bin of things deleted a month ago. */
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(purgeDeleted(env).then((result) => console.log("purged", result)));
  },
} satisfies ExportedHandler<Env>;
