import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { Tag, TagResponse, TagsResponse } from "../../shared/api.ts";
import { BUILT_IN_TAGS, slugify } from "../../shared/attempts.ts";
import { recordChange } from "../changes.ts";
import { tags } from "../db/schema.ts";
import type { AppEnv } from "../env.ts";
import { apiError } from "../http.ts";

const createTag = z.object({
  kind: z.enum(["failure", "success"]),
  label: z.string().trim().min(1).max(40),
});

const toTag = (row: Tag): Tag => ({ kind: row.kind, slug: row.slug, label: row.label });

/**
 * Failure tags and success notes people added. The built-in ones live in
 * shared/attempts.ts and aren't stored.
 */
export const tagRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const rows = await c.var.db.select().from(tags);
    const list = rows.map(toTag).sort((a, b) => a.label.localeCompare(b.label) || a.kind.localeCompare(b.kind));
    return c.json<TagsResponse>({ tags: list });
  })

  /** Adding one that exists (built in or not) returns it, so a retry or a double tap is harmless. */
  .post("/", async (c) => {
    const parsed = createTag.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return apiError(c, 400, "invalid", "A tag needs a short name.");
    const { kind, label } = parsed.data;
    const slug = slugify(label);
    if (!slug) return apiError(c, 400, "invalid", "A tag needs some letters or numbers.");

    const builtIn = BUILT_IN_TAGS[kind].find((tag) => tag.slug === slug);
    if (builtIn) return c.json<TagResponse>({ tag: { kind, slug, label: builtIn.label } });

    const [[inserted]] = await c.var.db.batch([
      c.var.db
        .insert(tags)
        .values({ kind, slug, label, createdBy: c.var.user.id, createdAt: new Date() })
        .onConflictDoNothing()
        .returning(),
      recordChange(c.var.db, {
        entity: "tag",
        id: `${kind}:${slug}`,
        action: "created",
        actor: c.var.actor,
      }),
    ]);
    if (inserted) return c.json<TagResponse>({ tag: toTag(inserted) }, 201);
    const existing = await c.var.db
      .select()
      .from(tags)
      .where(and(eq(tags.kind, kind), eq(tags.slug, slug)))
      .get();
    if (!existing) return apiError(c, 500, "server_error", "The tag wasn't saved.");
    return c.json<TagResponse>({ tag: toTag(existing) });
  });
