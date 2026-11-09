import { app } from "./app.ts";
import { purgeDeleted } from "./photos.ts";

export default {
  fetch: app.fetch,
  /** Daily (see triggers in wrangler.jsonc): empties the bin of things deleted a month ago. */
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(purgeDeleted(env).then((result) => console.log("purged", result)));
  },
} satisfies ExportedHandler<Env>;
