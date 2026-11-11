import { z } from "zod";
import { AGENT_SCOPES, type AgentScope } from "../../shared/agents.ts";
import { DELIVERY_HEADER, SIGNATURE_HEADER, TIMESTAMP_HEADER } from "../../shared/webhooks.ts";
import { needsFor, scopeList } from "../auth/scopes.ts";
import { SESSION_COOKIE } from "../auth/session.ts";
import { type Operation, operations } from "./operations.ts";
import { ApiError, WebhookPayload } from "./schemas.ts";

type Json = Record<string, unknown>;

/** The one route that is its own subject: any token reads it, whatever its scopes. */
export const OPENAPI_PATH = "/openapi.json";
const OPENAPI_OPERATION: Operation = {
  summary: "This document: what the API offers the caller, as OpenAPI 3.1.",
  response: z.looseObject({ openapi: z.literal("3.1.0") }),
};

/** All the operations, with the route's own key: "GET /items/:id". `/files/:id/:part?` is two paths. */
export const allOperations: Record<string, Operation> = { [`GET ${OPENAPI_PATH}`]: OPENAPI_OPERATION, ...operations };

const SHARED_ERRORS: Record<number, string> = {
  400: "invalid: the request couldn't be read; the message says what is wrong.",
  401: "signed_out or invalid_token: no credentials, or a token that is unknown or revoked.",
  403: "missing_scope or person_only: the token lacks the scope, or only a signed-in person may.",
  404: "not_found: no such thing.",
};

const defs = new Map<string, Json>();

/** JSON Schema (2020-12, which OpenAPI 3.1 speaks) for a zod schema; named schemas are hoisted into components. */
function schemaOf(schema: z.ZodType, io: "input" | "output"): Json {
  const made = z.toJSONSchema(schema, { target: "draft-2020-12", io, unrepresentable: "any" }) as Json;
  const { $schema: _schema, $defs, ...rest } = made;
  for (const [name, def] of Object.entries(($defs as Record<string, Json>) ?? {})) defs.set(name, def);
  return rest;
}

const ref = (text: string) => text.replaceAll("#/$defs/", "#/components/schemas/");

/** `/items/:id/photos/:photoId` → `/api/items/{id}/photos/{photoId}`; `:part?` becomes two paths. */
function pathsOf(route: string): string[] {
  const full = `/api${route}`;
  const optional = /\/:([A-Za-z]+)\?$/.exec(full);
  const toBraces = (path: string) => path.replace(/:([A-Za-z]+)/g, "{$1}");
  if (!optional) return [toBraces(full)];
  return [toBraces(full.slice(0, optional.index)), toBraces(full.replace("?", ""))];
}

const pascal = (text: string) => text.replace(/(^|[-_.])([a-z])/g, (_, __, letter: string) => letter.toUpperCase());
function operationId(method: string, path: string) {
  const parts = path
    .replace(/^\/api\//, "")
    .split("/")
    .map((part) => (part.startsWith("{") ? `By${pascal(part.slice(1, -1))}` : pascal(part)));
  return method.toLowerCase() + parts.join("");
}

function parametersOf(path: string, op: Operation): Json[] {
  const fromPath = [...path.matchAll(/\{([A-Za-z]+)\}/g)].map(([, name]) => ({
    name,
    in: "path",
    required: true,
    schema: { type: "string" },
  }));
  if (!op.query) return fromPath;
  const query = schemaOf(op.query, "input") as { properties?: Record<string, Json>; required?: string[] };
  const fromQuery = Object.entries(query.properties ?? {}).map(([name, schema]) => ({
    name,
    in: "query",
    required: query.required?.includes(name) ?? false,
    schema: JSON.parse(ref(JSON.stringify(schema))) as Json,
  }));
  return [...fromPath, ...fromQuery];
}

function bodyOf(op: Operation): Json | undefined {
  if (op.body) return { required: true, content: { "application/json": { schema: schemaOf(op.body, "input") } } };
  if (!op.multipart) return undefined;
  const fields = schemaOf(op.multipart.fields, "input") as { properties?: Record<string, Json>; required?: string[] };
  const files = Object.fromEntries(
    Object.entries(op.multipart.files).map(([name, description]) => [
      name,
      { type: "string", contentEncoding: "base64", contentMediaType: "application/octet-stream", description },
    ]),
  );
  return {
    required: true,
    content: {
      "multipart/form-data": {
        schema: {
          type: "object",
          properties: { ...fields.properties, ...files },
          required: [...(fields.required ?? []), ...(op.multipart.required ?? [])],
        },
      },
    },
  };
}

const errorResponse = (description: string): Json => ({
  description,
  content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
});

function responsesOf(op: Operation, scoped: boolean, hasParams: boolean): Json {
  const status = String(op.status ?? 200);
  const success: Json =
    op.response === "empty" || op.status === 204
      ? { description: "Done; nothing comes back." }
      : op.response === "binary"
        ? {
            description: "The bytes.",
            content: { "application/octet-stream": { schema: { type: "string", contentEncoding: "binary" } } },
          }
        : op.response === "markdown"
          ? { description: "Markdown.", content: { "text/markdown": { schema: { type: "string" } } } }
          : {
              description: "Done.",
              content: { "application/json": { schema: schemaOf(op.response ?? z.looseObject({}), "output") } },
            };
  const errors: Record<number, string> = {};
  if (!op.public) errors[401] = SHARED_ERRORS[401] as string;
  if (scoped) errors[403] = SHARED_ERRORS[403] as string;
  if (op.body || op.query || op.multipart) errors[400] = SHARED_ERRORS[400] as string;
  if (hasParams) errors[404] = SHARED_ERRORS[404] as string;
  Object.assign(errors, op.errors);
  return {
    [status]: success,
    ...Object.fromEntries(
      Object.entries(errors)
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([code, text]) => [code, errorResponse(text)]),
    ),
  };
}

/** What the caller may do with this operation: the scopes any one of which is enough, or "person". */
function needsOf(method: string, route: string, scopes: readonly AgentScope[] | null) {
  const needs = route === OPENAPI_PATH ? AGENT_SCOPES : needsFor(method, route);
  const allowed = scopes === null || (needs !== "person" && needs.some((scope) => scopes.includes(scope)));
  return { needs, allowed };
}

/**
 * The OpenAPI 3.1 document, made from the operations table, the zod schemas and the scope rules (auth/scopes.ts)
 * each time it is asked for. `scopes` is the caller's token's, or null for a signed-in person: a token is only told
 * about what its scopes allow; a person sees everything, with the person-only operations marked.
 */
export function buildOpenApi(scopes: readonly AgentScope[] | null, origin: string): Json {
  defs.clear();
  const paths: Record<string, Record<string, Json>> = {};
  for (const [key, op] of Object.entries(allOperations)) {
    const [method = "GET", route = "/"] = key.split(" ");
    const { needs, allowed } = needsOf(method, route, scopes);
    if (!allowed && !op.public) continue;
    for (const path of pathsOf(route)) {
      const description = [
        op.description,
        op.public
          ? "No credentials needed."
          : needs === "person"
            ? "Only a signed-in person, never an agent token."
            : `Needs the ${scopeList(needs)} scope.`,
        needs !== "person" && !op.public && route !== OPENAPI_PATH
          ? "A route may narrow this by what the body asks for; see docs/api.md."
          : undefined,
      ]
        .filter(Boolean)
        .join(" ");
      const body = bodyOf(op);
      const operation: Json = {
        operationId: operationId(method, path),
        summary: op.summary,
        description,
        tags: [path.split("/")[2] ?? "api"],
        parameters: parametersOf(path, op),
        ...(body ? { requestBody: body } : {}),
        responses: responsesOf(op, needs !== "person" && !op.public, path.includes("{")),
        security: op.public
          ? []
          : needs === "person"
            ? [{ sessionCookie: [] }]
            : [{ bearerAuth: [] }, { sessionCookie: [] }],
        "x-scopes": needs === "person" ? "person" : needs,
      };
      if ((operation.parameters as Json[]).length === 0) delete operation.parameters;
      paths[path] = { ...paths[path], [method.toLowerCase()]: operation };
    }
  }

  const document: Json = {
    openapi: "3.1.0",
    info: {
      title: "Spaghetti API",
      version: "1.0.0",
      summary: "A private 3D printing notebook for two people, and what agents can do in it.",
      description:
        "Made from the code, never written by hand. Auth is a bearer token (`Authorization: Bearer spg_…`) for agents or the session cookie for people; a token only sees what its scopes allow. Times are epoch milliseconds, ids are UUIDs the client picks, and every write is safe to retry. See docs/api.md.",
    },
    servers: [{ url: origin }],
    tags: [...new Set(Object.keys(paths).map((path) => path.split("/")[2] ?? "api"))].sort().map((name) => ({ name })),
    paths,
    webhooks: { change: webhookDescription() },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description: "An agent's token, `spg_…`; made on the Agents page.",
        },
        sessionCookie: {
          type: "apiKey",
          in: "cookie",
          name: SESSION_COOKIE,
          description: "A signed-in person's session.",
        },
      },
      schemas: {},
    },
  };
  // Named schemas used above, plus Error (every refusal) and the webhook payload.
  schemaOf(ApiError, "output");
  const components = document.components as { schemas: Record<string, Json> };
  components.schemas = Object.fromEntries([...defs].sort(([a], [b]) => a.localeCompare(b)));
  return JSON.parse(ref(JSON.stringify(document))) as Json;
}

function webhookDescription(): Json {
  const header = (description: string) => ({ required: true, schema: { type: "string" }, description });
  return {
    post: {
      summary: "A change on the feed, POSTed to a webhook.",
      description:
        "One change per request, in the shape of `GET /api/changes`. Check the signature before trusting it (docs/api.md, Webhooks); answer 2xx quickly, anything else is retried for a day.",
      parameters: [
        { name: TIMESTAMP_HEADER, in: "header", ...header("Seconds since the epoch when it was sent.") },
        {
          name: SIGNATURE_HEADER,
          in: "header",
          ...header("`v1=` and the hex HMAC-SHA256, with the webhook's secret, of `<timestamp>.<body>`."),
        },
        { name: DELIVERY_HEADER, in: "header", ...header("The delivery's id, the same across retries.") },
      ],
      requestBody: { required: true, content: { "application/json": { schema: schemaOf(WebhookPayload, "output") } } },
      responses: { "2XX": { description: "Received." } },
    },
  };
}
