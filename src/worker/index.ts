import { app } from "./app.ts";

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Env>;
