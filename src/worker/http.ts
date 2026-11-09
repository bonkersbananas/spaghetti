import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Person } from "../shared/api.ts";
import type { User } from "./db/schema.ts";

export function apiError(c: Context, status: ContentfulStatusCode, code: string, message: string) {
  return c.json({ error: { code, message } }, status);
}

export function toPerson(user: User): Person {
  return { id: user.id, username: user.username, name: user.name, color: user.color };
}
