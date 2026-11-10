import type { Context } from "hono";
import type { AgentScope } from "../../shared/agents.ts";
import type { AppEnv } from "../env.ts";
import { apiError } from "../http.ts";

/**
 * What a request needs, for an agent's token: one of the listed scopes, or "person"
 * (only a signed-in person, never a token). People are never checked against this.
 * Anything not listed is person-only, so a new route is closed to tokens until it is
 * given a scope here; `test/worker/agents.test.ts` has one case per row.
 */
export type Needs = readonly AgentScope[] | "person";

const id = "[^/]+";
const rules: Array<[method: string, path: RegExp, needs: Needs]> = [
  ["POST", /^\/items$/, ["capture"]],
  // The route narrows it: a stage move or a cover photo needs "attempts".
  ["PATCH", new RegExp(`^/items/${id}$`), ["capture", "attempts"]],
  ["PUT", new RegExp(`^/items/${id}/photos/order$`), ["capture"]],
  // The route narrows it: a photo of an attempt may come from "attempts", any other needs "capture".
  ["PUT", new RegExp(`^/items/${id}/photos/${id}$`), ["capture", "attempts"]],
  ["POST", new RegExp(`^/items/${id}/attempts$`), ["attempts"]],
  ["PATCH", new RegExp(`^/attempts/${id}$`), ["attempts"]],
  ["POST", new RegExp(`^/attempts/${id}/finish$`), ["attempts"]],
  ["PUT", new RegExp(`^/attempts/${id}/file$`), ["attempts"]],
  ["POST", /^\/tags$/, ["attempts"]],
  ["POST", /^\/spools$/, ["printer"]],
  ["PATCH", new RegExp(`^/spools/${id}$`), ["printer"]],
  ["PUT", new RegExp(`^/spools/${id}/photo/${id}$`), ["printer"]],
  ["PUT", /^\/printer$/, ["printer"]],
  ["PUT", new RegExp(`^/printer/slots/${id}$`), ["printer"]],
];

/** Reading is `read`, except the session and agent management, which tokens never see. */
const PERSON_ONLY_READS = /^\/(session|agents)(\/|$)/;

/** `path` is relative to /api. */
export function needsFor(method: string, path: string): Needs {
  if (method === "GET" || method === "HEAD") return PERSON_ONLY_READS.test(path) ? "person" : ["read"];
  const normalized = path.length > 1 ? path.replace(/\/$/, "") : path;
  return rules.find(([m, pattern]) => m === method && pattern.test(normalized))?.[2] ?? "person";
}

export const scopeList = (scopes: readonly AgentScope[]) => scopes.map((scope) => `"${scope}"`).join(" or ");

/** Whether this request may use `scope`: people always, tokens when granted it. */
export const canUse = (c: Context<AppEnv>, scope: AgentScope) => !c.var.scopes || c.var.scopes.includes(scope);

/** The 403 that names what is missing. */
export const missingScope = (c: Context<AppEnv>, needs: readonly AgentScope[]) =>
  apiError(c, 403, "missing_scope", `This token needs the ${scopeList(needs)} scope for that.`);
