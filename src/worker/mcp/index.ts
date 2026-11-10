import { Hono } from "hono";
import { z } from "zod";
import { app } from "../app.ts";
import { bearerToken, readAgentToken } from "../auth/agent.ts";
import { getDb } from "../db/index.ts";
import { type ApiResult, describeTool, toolByName, tools } from "./tools.ts";

/**
 * The MCP server: Model Context Protocol over Streamable HTTP, at /mcp, for
 * agents (Claude and others) with an agent bearer token. Stateless: every POST is
 * a whole JSON-RPC exchange answered as JSON, there are no sessions and no
 * streams (GET and DELETE are 405), so it needs no Durable Object and runs the
 * same on Workers, workerd and the container.
 *
 * Hand-written rather than the official SDK: the protocol surface we need is five
 * methods, and the SDK's Node-oriented dependency tree (and a schema validator
 * that compiles code at runtime, which Workers forbid) isn't worth it here.
 * Tools don't touch the database themselves: they call Spaghetti's own API with
 * the caller's token, so scopes, validation, the "via" attribution and the change
 * feed behave exactly as for any other request.
 */

const SUPPORTED_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const SERVER_INFO = { name: "spaghetti", title: "Spaghetti", version: "1.0.0" };
const INSTRUCTIONS =
  "Spaghetti is a private notebook where two people capture 3D printing ideas, follow builds through every print attempt and keep a journal of what worked and what failed. Start with search to find a build_id, read its story with get_build, and use what_worked before starting a new attempt. Failures are worth recording: log them with their tags.";

const message = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string(),
  params: z.record(z.string(), z.unknown()).optional(),
});
type Message = z.infer<typeof message>;

const rpcError = (id: Message["id"] | null, code: number, text: string) => ({
  jsonrpc: "2.0" as const,
  id: id ?? null,
  error: { code, message: text },
});
const rpcResult = (id: Message["id"], result: unknown) => ({ jsonrpc: "2.0" as const, id: id ?? null, result });

interface Caller {
  authorization: string;
  origin: string;
  env: Env;
  ctx: Parameters<typeof app.fetch>[2];
}

/** Calls Spaghetti's API as the same agent. */
function apiCaller({ authorization, origin, env, ctx }: Caller) {
  return async (path: string, init: { method?: string; json?: unknown; form?: FormData } = {}): Promise<ApiResult> => {
    const headers = new Headers({ Authorization: authorization, Accept: "application/json, text/markdown" });
    let body: BodyInit | undefined;
    if (init.json !== undefined) {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(init.json);
    } else if (init.form) body = init.form;
    const response = await app.fetch(
      new Request(`${origin}${path}`, { method: init.method ?? "GET", headers, body }),
      env,
      ctx,
    );
    const text = response.status === 204 ? "" : await response.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // Markdown and other text.
    }
    return { ok: response.ok, status: response.status, json, text };
  };
}

async function handle(msg: Message, caller: Caller): Promise<ReturnType<typeof rpcResult | typeof rpcError> | null> {
  const { id, method, params } = msg;
  // Notifications have no id and get no answer.
  if (id === undefined) return null;
  switch (method) {
    case "initialize": {
      const asked = typeof params?.protocolVersion === "string" ? params.protocolVersion : "";
      return rpcResult(id, {
        protocolVersion: SUPPORTED_VERSIONS.includes(asked) ? asked : (SUPPORTED_VERSIONS[0] as string),
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, { tools: tools.map(describeTool) });
    case "tools/call": {
      const entry = typeof params?.name === "string" ? toolByName.get(params.name) : undefined;
      if (!entry) return rpcError(id, -32602, `Unknown tool: ${String(params?.name)}`);
      const args = entry.input.safeParse(params?.arguments ?? {});
      if (!args.success) {
        const problems = args.error.issues.map((issue) => `${issue.path.join(".") || "arguments"}: ${issue.message}`);
        return rpcResult(id, {
          content: [{ type: "text", text: `Invalid arguments. ${problems.join("; ")}` }],
          isError: true,
        });
      }
      try {
        const result = await entry.run(args.data as never, { call: apiCaller(caller) });
        return rpcResult(id, {
          content: [{ type: "text", text: result.text }],
          ...(result.isError ? { isError: true } : {}),
        });
      } catch (error) {
        console.error("mcp tool failed", entry.name, error instanceof Error ? error.message : "");
        return rpcResult(id, { content: [{ type: "text", text: "Something went wrong on our side." }], isError: true });
      }
    }
    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

const notAllowed = () =>
  new Response("MCP here is POST only (stateless).", { status: 405, headers: { Allow: "POST" } });

export const mcpRoutes = new Hono<{ Bindings: Env }>()
  .get("/mcp", notAllowed)
  .delete("/mcp", notAllowed)
  .post("/mcp", async (c) => {
    // Only agent tokens: a browser's cookie never reaches this.
    const token = bearerToken(c);
    const agent = token ? await readAgentToken(getDb(c.env.DB), token) : null;
    if (!agent) {
      return c.json(rpcError(null, -32001, "Send an agent token as Authorization: Bearer spg_…"), 401, {
        "WWW-Authenticate": 'Bearer realm="spaghetti"',
      });
    }
    const body = await c.req.json().catch(() => undefined);
    if (body === undefined) return c.json(rpcError(null, -32700, "That wasn't JSON."), 400);
    const caller: Caller = {
      authorization: c.req.header("authorization") as string,
      origin: new URL(c.req.url).origin,
      env: c.env,
      ctx: (() => {
        try {
          return c.executionCtx as Caller["ctx"];
        } catch {
          return undefined;
        }
      })(),
    };
    const batch = Array.isArray(body);
    const answers = [];
    for (const raw of batch ? body : [body]) {
      const parsed = message.safeParse(raw);
      if (!parsed.success) {
        // A response or something else: nothing to answer unless it has an id we can name.
        if (raw && typeof raw === "object" && "result" in raw) continue;
        answers.push(rpcError(null, -32600, "That isn't a JSON-RPC request."));
        continue;
      }
      const answer = await handle(parsed.data, caller);
      if (answer) answers.push(answer);
    }
    // Only notifications or responses: accepted, nothing to say.
    if (!answers.length) return c.body(null, 202);
    return c.json(batch ? answers : answers[0]);
  });
