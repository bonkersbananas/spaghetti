import type { Context } from "hono";
import { AGENT_SCOPES, type AgentScope } from "../../shared/agents.ts";
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
  // An idea needs "capture"; a build started from scratch (stage "building") needs "attempts".
  // Sharing in: an idea from a link, some text or photos (iOS Shortcuts, the bookmarklet).
  ["POST", /^\/capture$/, ["capture"]],
  ["POST", /^\/items$/, ["capture", "attempts"]],
  // The route narrows it: a stage move or a cover photo needs "attempts".
  ["PATCH", new RegExp(`^/items/${id}$`), ["capture", "attempts"]],
  ["PUT", /^\/items\/up-next\/order$/, ["capture"]],
  ["PUT", new RegExp(`^/items/${id}/photos/order$`), ["capture"]],
  // The route narrows it: a photo of an attempt may come from "attempts", any other needs "capture".
  ["PUT", new RegExp(`^/items/${id}/photos/${id}$`), ["capture", "attempts"]],
  // A slicer file kept with an idea: added like a photo. Removing and restoring are for people.
  ["PUT", new RegExp(`^/items/${id}/files/${id}$`), ["capture", "attempts"]],
  // A big file is sent in parts first (the route lets only people send a model's sliced file).
  ["POST", /^\/uploads$/, ["capture", "attempts"]],
  ["PUT", new RegExp(`^/uploads/${id}/${id}/${id}/${id}$`), ["capture", "attempts"]],
  ["POST", new RegExp(`^/uploads/${id}/${id}/${id}/complete$`), ["capture", "attempts"]],
  ["DELETE", new RegExp(`^/uploads/${id}/${id}/${id}$`), ["capture", "attempts"]],
  ["POST", new RegExp(`^/items/${id}/attempts$`), ["attempts"]],
  // Comments: agents write and edit their own (through their owner's name); deleting is for people.
  ["POST", new RegExp(`^/items/${id}/comments$`), ["capture", "attempts"]],
  ["PATCH", new RegExp(`^/comments/${id}$`), ["capture", "attempts"]],
  // A build's parts: agents add and change them; removing one is for people.
  ["PUT", new RegExp(`^/items/${id}/parts$`), ["attempts"]],
  ["PATCH", new RegExp(`^/attempts/${id}$`), ["attempts"]],
  ["POST", new RegExp(`^/attempts/${id}/finish$`), ["attempts"]],
  ["PUT", new RegExp(`^/attempts/${id}/file$`), ["attempts"]],
  ["POST", /^\/tags$/, ["attempts"]],
  // A recipe is saved from an attempt that worked; its name and note change the same way. Deleting is for people.
  ["POST", /^\/recipes$/, ["attempts"]],
  ["PATCH", new RegExp(`^/recipes/${id}$`), ["attempts"]],
  // A twist is made from an idea, changed and renamed by the same agents that capture. Deleting is for people.
  ["POST", /^\/twists$/, ["capture"]],
  ["PATCH", new RegExp(`^/twists/${id}$`), ["capture"]],
  // The shopping list: an agent (or the bridge) may add to it, tick things off and sort it. Removing is for people.
  ["POST", /^\/shopping-items$/, ["printer"]],
  ["PUT", /^\/shopping-items\/order$/, ["printer"]],
  ["PATCH", new RegExp(`^/shopping-items/${id}$`), ["printer"]],
  ["POST", /^\/spools$/, ["printer"]],
  ["PATCH", new RegExp(`^/spools/${id}$`), ["printer"]],
  ["PUT", new RegExp(`^/spools/${id}/photo/${id}$`), ["printer"]],
  ["PUT", new RegExp(`^/spools/${id}/weight$`), ["printer"]],
  ["POST", new RegExp(`^/spools/${id}/weighings$`), ["printer"]],
  ["PUT", /^\/printer$/, ["printer"]],
  ["PUT", /^\/printer\/bridge$/, ["printer"]],
  ["PUT", new RegExp(`^/printer/slots/${id}$`), ["printer"]],
  // Upkeep: agents add, edit and log; removing a task or a "Done" is for people.
  ["POST", /^\/printer\/upkeep$/, ["printer"]],
  ["PATCH", new RegExp(`^/printer/upkeep/${id}$`), ["printer"]],
  ["POST", new RegExp(`^/printer/upkeep/${id}/done$`), ["printer"]],
  ["PUT", new RegExp(`^/printer/upkeep/logs/${id}/photo/${id}$`), ["printer"]],
];

/**
 * Reading is `read`, except the session, account (passkeys, sign-in links, invites, devices) and agent management, which tokens never see, and link
 * previews: the Worker would fetch any public page for whoever asks, so only a signed-in person may.
 */
const PERSON_ONLY_READS =
  /^\/(session|account|join|agents|oauth|webhooks|links|push|features|deleted|reactions|comments\/unread)(\/|$)/;

/** `path` is relative to /api. */
export function needsFor(method: string, path: string): Needs {
  // The OpenAPI document is for any token: it only lists what that token's scopes allow.
  if (method === "GET" && path === "/openapi.json") return AGENT_SCOPES;
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
