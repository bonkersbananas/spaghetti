import { readFileSync, writeFileSync } from "node:fs";
import { Validator } from "@seriousme/openapi-schema-validator";
import { describe, expect, it } from "vitest";
import { app } from "../../src/worker/app.ts";
import { allOperations, buildOpenApi } from "../../src/worker/openapi/document.ts";

const ORIGIN = "https://spaghetti.test";
const keyOf = (method: string, path: string) => `${method} ${path.replace(/^\/api/, "") || "/"}`;

/** Every route the app answers (middleware and the catch-alls aren't routes). */
const routes = app.routes.filter((route) => route.method !== "ALL").map((route) => keyOf(route.method, route.path));

describe("the OpenAPI document", () => {
  it("describes every route the API has, and only those", () => {
    const described = new Set(Object.keys(allOperations));
    expect(
      routes.filter((route) => !described.has(route)),
      "routes the document doesn't describe: add them to worker/openapi/operations.ts",
    ).toEqual([]);
    expect(
      [...described].filter((key) => !routes.includes(key)),
      "operations without a route",
    ).toEqual([]);
  });

  it("is published as docs/openapi.json, for the installed app's link (UPDATE_OPENAPI=1 rewrites it)", () => {
    const file = "docs/openapi.json";
    const made = `${JSON.stringify(buildOpenApi(null, "https://spaghetti.day"), null, 2)}\n`;
    if (process.env.UPDATE_OPENAPI) writeFileSync(file, made);
    expect(readFileSync(file, "utf8") === made, "docs/openapi.json is stale: run UPDATE_OPENAPI=1 pnpm test").toBe(
      true,
    );
  });

  it("is valid OpenAPI 3.1", async () => {
    for (const scopes of [null, ["read"], ["capture", "attempts", "printer"]] as const) {
      const result = await new Validator().validate(buildOpenApi(scopes, ORIGIN));
      expect(result.valid, JSON.stringify(result.errors)?.slice(0, 600)).toBe(true);
    }
  });

  it("gives every operation a summary, a unique id, its scopes and the error shape", () => {
    const document = buildOpenApi(null, ORIGIN) as {
      paths: Record<string, Record<string, Record<string, unknown>>>;
      components: { schemas: Record<string, unknown> };
    };
    const ids = new Set<string>();
    for (const [path, methods] of Object.entries(document.paths)) {
      for (const [method, op] of Object.entries(methods)) {
        const where = `${method.toUpperCase()} ${path}`;
        expect(typeof op.summary === "string" && (op.summary as string).length > 8, `${where} summary`).toBe(true);
        expect(op["x-scopes"], `${where} scopes`).toBeTruthy();
        expect(ids.has(op.operationId as string), `${where} operationId is unique`).toBe(false);
        ids.add(op.operationId as string);
        const responses = op.responses as Record<string, unknown>;
        const refused = Object.keys(responses).filter((status) => Number(status) >= 400);
        if (path !== "/api/health") expect(refused.length, `${where} documents its refusals`).toBeGreaterThan(0);
      }
    }
    expect(document.components.schemas.Error).toBeDefined();
  });

  it("lists to a token only what its scopes allow, and to a person everything", () => {
    const pathsOf = (scopes: readonly ("read" | "capture" | "attempts" | "printer")[] | null) =>
      Object.entries(
        (buildOpenApi(scopes, ORIGIN) as { paths: Record<string, Record<string, unknown>> }).paths,
      ).flatMap(([path, methods]) => Object.keys(methods).map((method) => `${method.toUpperCase()} ${path}`));
    const person = pathsOf(null);
    const reader = pathsOf(["read"]);
    const capturer = pathsOf(["capture"]);
    expect(person.length).toBeGreaterThan(reader.length);
    expect(reader).toContain("GET /api/items");
    expect(reader).toContain("GET /api/openapi.json");
    expect(reader).not.toContain("POST /api/items");
    expect(reader).not.toContain("GET /api/agents");
    expect(reader).not.toContain("GET /api/webhooks");
    expect(reader).not.toContain("DELETE /api/items/{id}");
    expect(capturer).toContain("POST /api/items");
    expect(capturer).toContain("POST /api/capture");
    expect(capturer).not.toContain("POST /api/spools");
    expect(capturer).not.toContain("GET /api/items"); // read is its own scope
    expect(person).toContain("POST /api/webhooks");
  });
});
