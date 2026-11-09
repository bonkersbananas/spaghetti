import { asc } from "drizzle-orm";
import { Hono } from "hono";
import type { PeopleResponse } from "../../shared/api.ts";
import { users } from "../db/schema.ts";
import type { AppEnv } from "../env.ts";
import { toPerson } from "../http.ts";

export const peopleRoutes = new Hono<AppEnv>().get("/", async (c) => {
  const rows = await c.var.db.select().from(users).orderBy(asc(users.createdAt));
  return c.json<PeopleResponse>({ people: rows.map(toPerson) });
});
