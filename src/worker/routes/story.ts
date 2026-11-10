import { Hono } from "hono";
import { buildStory } from "../../shared/story.ts";
import { agents, tags, users } from "../db/schema.ts";
import type { AppEnv } from "../env.ts";
import { apiError } from "../http.ts";
import { loadItem } from "./items.ts";

/** /api/builds/:id/story.md: a build's whole story as one markdown document (for people, and for agents). */
export const storyRoutes = new Hono<AppEnv>().get("/:id/story.md", async (c) => {
  const db = c.var.db;
  const item = await loadItem(db, c.req.param("id"));
  if (!item) return apiError(c, 404, "not_found", "That isn't here any more.");
  const [people, agentRows, tagRows] = await Promise.all([
    db.select().from(users),
    db.select().from(agents),
    db.select().from(tags),
  ]);
  const markdown = buildStory(item, {
    people: new Map(people.map((person) => [person.id, person])),
    agents: new Map(agentRows.map((agent) => [agent.id, agent.name])),
    customFailureTags: tagRows.filter((tag) => tag.kind === "failure"),
    customSuccessNotes: tagRows.filter((tag) => tag.kind === "success"),
  });
  return c.body(markdown, 200, { "Content-Type": "text/markdown; charset=utf-8" });
});
