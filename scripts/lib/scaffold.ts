/**
 * Names and templates for pnpm new. Pure (no file access), so the unit
 * tests can cover them; scripts/new.ts writes the files.
 */

/** "print queue", "printQueue" or "print-queue" → "print-queue". */
export function toKebab(name: string): string {
  return name
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .toLowerCase();
}

/** "print-queue" → "PrintQueue". */
export function toPascal(name: string): string {
  return toKebab(name)
    .split("-")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join("");
}

export const toCamel = (name: string) => {
  const pascal = toPascal(name);
  return pascal[0]?.toLowerCase() + pascal.slice(1);
};

/** "print-queue" → "Print queue". */
export function toLabel(name: string): string {
  const words = toKebab(name).replaceAll("-", " ");
  return words[0]?.toUpperCase() + words.slice(1);
}

/** "reminders" → "reminder", "batteries" → "battery". Good enough for resource names. */
export function singular(word: string): string {
  if (/ies$/.test(word)) return `${word.slice(0, -3)}y`;
  if (/(ss|us)$/.test(word)) return word;
  if (/s$/.test(word)) return word.slice(0, -1);
  return word;
}

/** The name must be one word or a few joined by dashes, starting with a letter. */
export function validName(name: string | undefined): name is string {
  return !!name && /^[a-zA-Z][a-zA-Z0-9 _-]*$/.test(name);
}

/**
 * Puts `text` on a new line before the first line that contains `marker`.
 * Returns the new source, or null when the marker isn't there.
 */
export function insertBefore(source: string, marker: string | RegExp, text: string): string | null {
  const lines = source.split("\n");
  const index = lines.findIndex((line) => (typeof marker === "string" ? line.includes(marker) : marker.test(line)));
  if (index < 0) return null;
  lines.splice(index, 0, ...text.split("\n"));
  return lines.join("\n");
}

/** Like insertBefore, after the first matching line. */
export function insertAfter(source: string, marker: string | RegExp, text: string): string | null {
  const lines = source.split("\n");
  const index = lines.findIndex((line) => (typeof marker === "string" ? line.includes(marker) : marker.test(line)));
  if (index < 0) return null;
  lines.splice(index + 1, 0, ...text.split("\n"));
  return lines.join("\n");
}

/* Templates ---------------------------------------------------------------- */

export function routeTemplate(name: string): string {
  const label = toLabel(name);
  const component = toPascal(name);
  return `import { createFileRoute } from "@tanstack/react-router";
import { EmptyPot } from "@/components/illustrations";
import { PageHeader } from "@/components/shell/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";

export const Route = createFileRoute("/_app/${toKebab(name)}")({
  component: ${component},
});

function ${component}() {
  // Fetch with useQuery (queries in lib/), show Skeletons while pending, and the EmptyState when there is nothing.
  return (
    <>
      <PageHeader title="${label}" subtitle="One line on what this page is for." />
      <EmptyState illustration={<EmptyPot />} title="Nothing here yet">
        Say plainly what goes here and how it gets here.
      </EmptyState>
    </>
  );
}
`;
}

export function routeE2eTemplate(name: string): string {
  const label = toLabel(name);
  return `import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("${toKebab(name)}: opens, and has no accessibility violations", async ({ page }) => {
  await signIn(page);
  await page.goto("/${toKebab(name)}");
  await expect(page.getByRole("heading", { level: 1, name: "${label}" })).toBeVisible();
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
    .analyze();
  expect(violations.map((violation) => violation.id)).toEqual([]);
});
`;
}

export function screenshotTemplate(name: string): string {
  return `  { name: "${toKebab(name)}", path: "/${toKebab(name)}", fullPage: true },`;
}

export function componentTemplate(name: string): string {
  const component = toPascal(name);
  return `import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

interface ${component}Props {
  children?: ReactNode;
  className?: string;
}

/**
 * One line on what ${component} is for and when to use it. Built from tokens only: colors, sizes and
 * shadows come from styles/tokens.css (the design lint fails on hex colors and arbitrary sizes).
 */
export function ${component}({ children, className }: ${component}Props) {
  return <div className={cn("bg-cream shadow-soft rounded-lg p-4", className)}>{children}</div>;
}
`;
}

/**
 * The styleguide section for a component (routes/_app/-styleguide/<id>.tsx): a live specimen,
 * in the shared Section and Panel markup the other sections use.
 */
export function styleguideSectionTemplate(name: string, importPath: string): string {
  const component = toPascal(name);
  return `import { ${component} } from "${importPath}";
import { Panel, Section } from "./shared";

/** Show every variant and state of ${component}; look at it in dark mode too (the switch at the top of the page). */
export function ${component}Section() {
  return (
    <Section id="${toKebab(name)}" title="${toLabel(name)}" note="One line on when to use it.">
      <Panel className="flex flex-wrap items-center gap-6">
        <${component}>Default</${component}>
      </Panel>
    </Section>
  );
}
`;
}

export function componentE2eTemplate(name: string): string {
  const id = toKebab(name);
  return `import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

// The ${toPascal(name)} specimen on /styleguide: it renders and passes axe, in both themes.
for (const theme of ["light", "dark"] as const) {
  test(\`${id}: styleguide specimen, \${theme}\`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await signIn(page);
    await page.goto("/styleguide#${id}");
    const section = page.locator("#${id}");
    await expect(section).toBeVisible();
    const { violations } = await new AxeBuilder({ page })
      .include("#${id}")
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
      .analyze();
    expect(violations.map((violation) => violation.id)).toEqual([]);
  });
}
`;
}

export function endpointTemplate(name: string): string {
  const path = toKebab(name);
  const entity = toPascal(singular(path));
  const schema = `create${entity}`;
  return `import { Hono } from "hono";
import { z } from "zod";
import type { ${entity}, ${entity}Response, ${toPascal(path)}Response } from "../../shared/api.ts";
import type { AppEnv } from "../env.ts";
import { apiError } from "../http.ts";

/** What POST /api/${path} accepts. The client picks the id, so a retried request is safe. */
const ${schema} = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(80),
});

/**
 * /api/${path}. Needs a session (mounted after requireUser in app.ts).
 * TODO: store it: add a table to db/schema.ts, \`pnpm db:generate --name ${path}\`, and query it
 * through c.var.db (see routes/tags.ts for a small example).
 */
export const ${toCamel(path)}Routes = new Hono<AppEnv>()
  .get("/", async (c) => {
    return c.json<${toPascal(path)}Response>({ ${toCamel(path)}: [] });
  })

  .post("/", async (c) => {
    const parsed = ${schema}.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return apiError(c, 400, "invalid", "That couldn't be read.");
    const ${toCamel(entity)}: ${entity} = { ...parsed.data, createdBy: c.var.user.id };
    return c.json<${entity}Response>({ ${toCamel(entity)} }, 201);
  });
`;
}

export function endpointTypesTemplate(name: string): string {
  const path = toKebab(name);
  const entity = toPascal(singular(path));
  return `
/** /api/${path} */
export interface ${entity} {
  id: string;
  name: string;
  /** Who made it. */
  createdBy: string;
}

export interface ${toPascal(path)}Response {
  ${toCamel(path)}: ${entity}[];
}

export interface ${entity}Response {
  ${toCamel(entity)}: ${entity};
}
`;
}

export function endpointQueryTemplate(name: string): string {
  const path = toKebab(name);
  return `
/** ${toLabel(path)}, from /api/${path}. Mutations update this cache optimistically (see lib/items.ts). */
export const ${toCamel(path)}Query = queryOptions({
  queryKey: ["${path}"],
  queryFn: async () => (await api<${toPascal(path)}Response>("/${path}")).${toCamel(path)},
});
`;
}

export function endpointTestTemplate(name: string): string {
  const path = toKebab(name);
  const entity = toPascal(singular(path));
  return `import { beforeEach, describe, expect, it } from "vitest";
import type { ${entity}Response, ${toPascal(path)}Response } from "../../src/shared/api.ts";
import { addUser, request, resetDb, signIn } from "./helpers.ts";

let cookie: string;

beforeEach(async () => {
  await resetDb();
  await addUser("alex", "correct horse", "Alex Rivera", "tomato");
  cookie = await signIn("alex", "correct horse");
});

describe("/api/${path}", () => {
  it("needs a session", async () => {
    expect((await request("/api/${path}")).status).toBe(401);
  });

  it("lists", async () => {
    const response = await request("/api/${path}", { cookie });
    expect(response.status).toBe(200);
    expect((await response.json<${toPascal(path)}Response>()).${toCamel(path)}).toEqual([]);
  });

  it("refuses what it can't read", async () => {
    const response = await request("/api/${path}", { method: "POST", cookie, json: { name: "" } });
    expect(response.status).toBe(400);
  });

  it("creates", async () => {
    const id = crypto.randomUUID();
    const response = await request("/api/${path}", { method: "POST", cookie, json: { id, name: "First" } });
    expect(response.status).toBe(201);
    expect((await response.json<${entity}Response>()).${toCamel(entity)}).toMatchObject({ id, name: "First" });
  });
});
`;
}
