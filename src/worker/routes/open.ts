import { Hono } from "hono";
import { type OpenPart, openName, opensInBambuStudio } from "../../shared/open-link.ts";
import { slicedName } from "../../shared/slicing/files.ts";
import { getDb } from "../db/index.ts";
import type { AppEnv } from "../env.ts";
import { verifyOpenLink } from "../open-link.ts";
import { fileKey } from "../photos.ts";
import { disposition, liveFile } from "./files.ts";

/** What a live file's part is called and whether there is one to open: its own .3mf, or a model's sliced file. */
export async function openable(
  c: Parameters<typeof liveFile>[0],
  id: string,
  part: OpenPart,
): Promise<{ name: string; stored: boolean } | null> {
  const row = (await liveFile(c, id))?.row;
  if (!row) return null;
  if (part === "sliced") {
    return row.kind === "model" && row.slice?.status === "sliced" ? { name: slicedName(row.name), stored: true } : null;
  }
  return row.stored && opensInBambuStudio(row.name) ? { name: row.name, stored: true } : null;
}

/**
 * GET /open/<token>/<name>: the one address that answers with no cookie, for Bambu Studio's own download
 * (decision 0058). The token says which file and until when and is checked first; anything wrong is the same plain
 * 404, so a stranger learns nothing. The file must still be on a live idea, build or twist. Read-only, never cached.
 */
export const openRoutes = new Hono<AppEnv>()
  .use(async (c, next) => {
    c.set("db", getDb(c.env.DB));
    await next();
  })
  .get("/open/:token/:name?", async (c) => {
    const gone = () => c.text("This link has expired or isn't valid.", 404, { "Cache-Control": "no-store" });
    const link = await verifyOpenLink(c.env, c.req.param("token"));
    if (!link) return gone();
    const found = await openable(c, link.id, link.part);
    if (!found) return gone();
    const object = await c.env.PHOTOS.get(fileKey(link.id, link.part));
    if (!object) return gone();
    c.header("Cache-Control", "no-store");
    c.header("Content-Type", "application/octet-stream");
    c.header("Content-Disposition", disposition(openName(found.name)));
    c.header("Content-Length", String(object.size));
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
    return c.body(object.body);
  });
