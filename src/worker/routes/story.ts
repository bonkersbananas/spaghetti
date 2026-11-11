import { and, asc, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { buildStory } from "../../shared/story.ts";
import { agents, comments, tags, users } from "../db/schema.ts";
import type { AppEnv } from "../env.ts";
import { apiError } from "../http.ts";
import { toApiComment } from "./comments.ts";
import { loadItem } from "./items.ts";

/** /api/builds/:id/story.md: a build's whole story as one markdown document (for people, and for agents). */
export const storyRoutes = new Hono<AppEnv>().get("/:id/story.md", async (c) => {
  const db = c.var.db;
  const item = await loadItem(db, c.req.param("id"));
  if (!item) return apiError(c, 404, "not_found", "That isn't here any more.");
  const [people, agentRows, tagRows, commentRows] = await Promise.all([
    db.select().from(users),
    db.select().from(agents),
    db.select().from(tags),
    db
      .select()
      .from(comments)
      .where(and(eq(comments.itemId, item.id), isNull(comments.deletedAt)))
      .orderBy(asc(comments.createdAt)),
  ]);
  const markdown = buildStory(item, {
    people: new Map(people.map((person) => [person.id, person])),
    agents: new Map(agentRows.map((agent) => [agent.id, agent.name])),
    customFailureTags: tagRows.filter((tag) => tag.kind === "failure"),
    customSuccessNotes: tagRows.filter((tag) => tag.kind === "success"),
    comments: commentRows.map((row) => toApiComment(row)),
  });
  return c.body(markdown, 200, { "Content-Type": "text/markdown; charset=utf-8" });
});
