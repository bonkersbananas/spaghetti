/**
 * pnpm new — creates the files for a route, a component or an endpoint, with
 * their wiring, so a new page doesn't start with a scavenger hunt.
 *
 *   pnpm new route <name> [--section | --workshop] [--shortcut "g x"]
 *       src/client/routes/_app/<name>.tsx (header, empty state), e2e/<name>.spec.ts (it opens),
 *       a screen in scripts/screenshot-routes.ts, and the regenerated routeTree.gen.ts.
 *       --section / --workshop: also an entry in components/shell/sections.ts (sidebar, tab bar,
 *       palette) and its shortcut in shared/shortcuts.ts.
 *   pnpm new component <Name> [--in ui|builds|ideas|journal|pantry|search|shell]
 *       components/<in>/<Name>.tsx (default ui) and its styleguide section in
 *       routes/_app/-styleguide/<name>.tsx, wired into the styleguide.
 *   pnpm new endpoint <plural-name>
 *       worker/routes/<name>.ts (zod schema, list and create), mounted in app.ts, types in
 *       shared/api.ts, a queryOptions in client/lib/queries.ts, and test/worker/<name>.test.ts.
 *
 * Add --dry-run to see what it would do. Existing files are never overwritten.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { createServer } from "vite";
import {
  componentTemplate,
  endpointQueryTemplate,
  endpointTemplate,
  endpointTestTemplate,
  endpointTypesTemplate,
  insertAfter,
  insertBefore,
  routeE2eTemplate,
  routeTemplate,
  screenshotTemplate,
  singular,
  styleguideSectionTemplate,
  toCamel,
  toKebab,
  toLabel,
  toPascal,
  validName,
} from "./lib/scaffold.ts";
import { root } from "./lib/wrangler.ts";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const flag = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const valueFlags = ["--shortcut", "--in"];
const positional = args.filter((arg, index) => !arg.startsWith("--") && !valueFlags.includes(args[index - 1] ?? ""));
const [kind, rawName] = positional;

const usage = `Usage:
  pnpm new route <name> [--section | --workshop] [--shortcut "g x"]
  pnpm new component <Name> [--in ui|builds|ideas|journal|pantry|search|shell]
  pnpm new endpoint <plural-name>
  (add --dry-run to see what would happen)`;
if (!kind || !["route", "component", "endpoint"].includes(kind) || !validName(rawName)) {
  console.error(usage);
  process.exit(1);
}
const kebab = toKebab(rawName);

const created: string[] = [];
const todo: string[] = [];
const path = (...parts: string[]) => join(root, ...parts);
const shown = (file: string) => relative(root, file);

function create(file: string, content: string) {
  if (existsSync(file)) {
    console.error(`✗ ${shown(file)} exists already; nothing was overwritten.`);
    process.exit(1);
  }
  created.push(shown(file));
  if (dryRun) return;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

/** Stops before anything is written if a file this command would create exists already. */
function assertFree(...files: string[]) {
  for (const file of files) {
    if (existsSync(file)) {
      console.error(`✗ ${shown(file)} exists already; nothing was created.`);
      process.exit(1);
    }
  }
}

/** Edits an existing file: puts `text` before a marker line, or leaves a to-do if the marker has moved. */
function wire(file: string, marker: string | RegExp, text: string, manual: string) {
  const source = readFileSync(file, "utf8");
  const next = insertBefore(source, marker, text);
  if (next === null) {
    todo.push(`${shown(file)}: ${manual}`);
    return;
  }
  created.push(`${shown(file)} (edited)`);
  if (!dryRun) writeFileSync(file, next);
}

/** Appends after the last line. */
function append(file: string, text: string) {
  created.push(`${shown(file)} (edited)`);
  if (!dryRun) writeFileSync(file, readFileSync(file, "utf8").replace(/\n*$/, "\n") + text);
}

if (kind === "route") {
  // Check everything that could stop us before the first file is written.
  assertFree(path("src/client/routes/_app", `${kebab}.tsx`), path("e2e", `${kebab}.spec.ts`));
  const placement = args.includes("--section") ? "sections" : args.includes("--workshop") ? "workshop" : null;
  const keys = flag("--shortcut") ?? `g ${kebab[0]}`;
  if (placement && readFileSync(path("src/shared/shortcuts.ts"), "utf8").includes(`keys: ["${keys}"]`)) {
    console.error(`✗ The keys "${keys}" are taken: pass another with --shortcut "g x". Nothing was created.`);
    process.exit(1);
  }
  create(path("src/client/routes/_app", `${kebab}.tsx`), routeTemplate(kebab));
  create(path("e2e", `${kebab}.spec.ts`), routeE2eTemplate(kebab));
  wire(
    path("scripts/screenshot-routes.ts"),
    "pnpm new route adds its screens above this line",
    screenshotTemplate(kebab),
    `add ${screenshotTemplate(kebab).trim()} to shots`,
  );
  if (placement) {
    const id = `go${toPascal(kebab)}`;
    wire(
      path("src/shared/shortcuts.ts"),
      /id: "paletteNext"/,
      `  { id: "${id}", group: "anywhere", label: "Go to ${toLabel(kebab)}", keys: ["${keys}"] },`,
      `add { id: "${id}", group: "anywhere", label: "Go to ${toLabel(kebab)}", keys: ["${keys}"] }`,
    );
    const sectionsFile = path("src/client/components/shell/sections.ts");
    const source = readFileSync(sectionsFile, "utf8");
    // The union types name every route and shortcut; add ours to both.
    let next = source
      .replace(/(to: "[^;]*?)(;)/, `$1 | "/${kebab}"$2`)
      .replace(/(shortcut: "[^;]*?)(;)/, `$1 | "${id}"$2`);
    const entry = `  { to: "/${kebab}", label: "${toLabel(kebab)}", icon: InfoIcon, shortcut: "${id}" }, // TODO: a Phosphor icon in components/ui/icons.tsx`;
    next =
      placement === "sections"
        ? next.replace(/(export const sections: Section\[\] = \[\n[\s\S]*?)(\n\];)/, `$1\n${entry}$2`)
        : next.replace(/(export const workshop: Section\[\] = \[\n[\s\S]*?)(\n\];)/, `$1\n${entry}$2`);
    if (!/InfoIcon,?\s*[\n}]/.test(next.split("export interface")[0] ?? ""))
      next = next.replace("  JournalIcon,", "  InfoIcon,\n  JournalIcon,");
    if (next === source) todo.push(`${shown(sectionsFile)}: add the section by hand`);
    else {
      created.push(`${shown(sectionsFile)} (edited)`);
      if (!dryRun) writeFileSync(sectionsFile, next);
    }
  }
  if (!dryRun) await regenerateRouteTree();
  todo.push(
    `pick an icon for the page in components/ui/icons.tsx${placement ? " (the section uses InfoIcon for now)" : ""}`,
  );
  todo.push(
    "fill in the page; add its states to the screenshots, and the route to a sweep and CHECKED_ROUTES in e2e/screens.spec.ts",
  );
}

if (kind === "component") {
  const component = toPascal(rawName);
  const dir = flag("--in") ?? "ui";
  if (!existsSync(path("src/client/components", dir))) {
    console.error(`✗ No components/${dir} folder.`);
    process.exit(1);
  }
  assertFree(
    path("src/client/components", dir, `${component}.tsx`),
    path("src/client/routes/_app/-styleguide", `${kebab}.tsx`),
  );
  create(path("src/client/components", dir, `${component}.tsx`), componentTemplate(component));
  create(
    path("src/client/routes/_app/-styleguide", `${kebab}.tsx`),
    styleguideSectionTemplate(component, `@/components/${dir}/${component}`),
  );
  const styleguide = path("src/client/routes/_app/styleguide.tsx");
  if (existsSync(styleguide)) {
    const source = readFileSync(styleguide, "utf8");
    // The styleguide page lists the sections: a table of contents, an import and the element.
    let next: string | null = insertBefore(source, /^\] as const;/, `  ["${kebab}", "${toLabel(kebab)}"],`);
    next =
      next &&
      insertBefore(
        next,
        /^import .* from "\.\/-styleguide\//,
        `import { ${component}Section } from "./-styleguide/${kebab}";`,
      );
    next = next && insertAfter(next, "<SkeletonSection />", `          <${component}Section />`);
    if (next) {
      created.push(`${shown(styleguide)} (edited)`);
      if (!dryRun) writeFileSync(styleguide, next);
    } else {
      todo.push(
        `${shown(styleguide)}: add ["${kebab}", "${toLabel(kebab)}"] to the table of contents and <${component}Section /> to the page`,
      );
    }
  } else {
    todo.push(
      `the styleguide: add ["${kebab}", "${toLabel(kebab)}"] to its table of contents and <${component}Section /> to the page`,
    );
  }
  todo.push(
    `show every variant and state in ${component}Section, and look at it in dark mode (the switch on /styleguide)`,
  );
  todo.push(
    `document it in docs/design.md; new colors or sizes go in styles/tokens.css, light and dark (and scripts/lib/contrast.ts for text pairs)`,
  );
}

if (kind === "endpoint") {
  const entity = toPascal(singular(kebab));
  if (singular(kebab) === kebab) {
    console.error(
      "✗ Name the endpoint by its plural (reminders), so its types can be told apart (Reminder, Reminders).",
    );
    process.exit(1);
  }
  assertFree(path("src/worker/routes", `${kebab}.ts`), path("test/worker", `${kebab}.test.ts`));
  create(path("src/worker/routes", `${kebab}.ts`), endpointTemplate(kebab));
  create(path("test/worker", `${kebab}.test.ts`), endpointTestTemplate(kebab));
  append(path("src/shared/api.ts"), endpointTypesTemplate(kebab));
  const queries = path("src/client/lib/queries.ts");
  const queriesSource = readFileSync(queries, "utf8");
  if (!/import \{[^}]*\bapi\b/.test(queriesSource)) todo.push("lib/queries.ts: import api");
  const withType = queriesSource.replace(
    /import type \{ ([^}]*) \} from "@shared\/api";/,
    (_, names: string) =>
      `import type { ${[...names.split(", "), `${toPascal(kebab)}Response`].sort().join(", ")} } from "@shared/api";`,
  );
  created.push(`${shown(queries)} (edited)`);
  if (!dryRun) writeFileSync(queries, withType.replace(/\n*$/, "\n") + endpointQueryTemplate(kebab));
  const app = path("src/worker/app.ts");
  const appSource = readFileSync(app, "utf8");
  const withImport = insertBefore(
    appSource,
    'import { peopleRoutes } from "./routes/people.ts";',
    `import { ${toCamel(kebab)}Routes } from "./routes/${kebab}.ts";`,
  );
  const withRoute =
    withImport &&
    insertBefore(withImport, '  .route("/", searchRoutes)', `  .route("/${kebab}", ${toCamel(kebab)}Routes)`);
  if (withRoute) {
    created.push(`${shown(app)} (edited)`);
    if (!dryRun) writeFileSync(app, withRoute);
  } else
    todo.push(
      `src/worker/app.ts: import ${toCamel(kebab)}Routes and mount it with .route("/${kebab}", …) after .use(requireUser)`,
    );
  todo.push(
    `${entity} isn't stored yet: add a table in db/schema.ts and \`pnpm db:generate --name ${kebab}\`, then query it in routes/${kebab}.ts`,
  );
  todo.push(
    "lib/queries.ts: the query is written; add the optimistic mutations next to it (onMutate, rollback on error)",
  );
}

console.log(
  `${dryRun ? "Would create or edit" : "Created or edited"}:\n${created.map((file) => `  ${file}`).join("\n")}`,
);
if (todo.length) console.log(`\nThen:\n${todo.map((line) => `  - ${line}`).join("\n")}`);
if (!dryRun) console.log("\nRun pnpm format && pnpm check when you have filled it in.");

/** The router plugin writes routeTree.gen.ts when Vite starts; start it just for that. */
async function regenerateRouteTree() {
  const server = await createServer({
    root,
    configFile: false,
    logLevel: "silent",
    appType: "custom",
    server: { middlewareMode: true },
    plugins: [
      tanstackRouter({
        target: "react",
        autoCodeSplitting: true,
        routesDirectory: "./src/client/routes",
        generatedRouteTree: "./src/client/routeTree.gen.ts",
      }),
    ],
  });
  await server.close();
  created.push("src/client/routeTree.gen.ts (regenerated)");
}
