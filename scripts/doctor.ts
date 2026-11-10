/**
 * pnpm doctor — checks what the repository needs to build, test and take
 * screenshots, and says how to fix each problem: Node, pnpm, installed
 * dependencies, the Playwright browser, wrangler and workerd, and the local
 * D1 state. Exits 1 if anything is broken (warnings don't fail it).
 *
 *   pnpm doctor
 *   SPAGHETTI_BROWSER=/usr/bin/chromium pnpm doctor   # check an existing Chromium
 */
import { spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { chromium } from "@playwright/test";
import { BROWSER_ENV, browserPath, launchOptions } from "./lib/browser.ts";
import { satisfiesMinimum } from "./lib/versions.ts";
import { root } from "./lib/wrangler.ts";

type Status = "ok" | "warn" | "fail";
interface Result {
  status: Status;
  /** What was found. */
  message: string;
  /** How to fix it (for warn and fail). */
  fix?: string;
}

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  engines?: { node?: string };
  packageManager?: string;
};

function run(command: string, args: string[], timeout = 60_000) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", timeout, env: { ...process.env, CI: "1" } });
  return { ok: result.status === 0, out: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim(), error: result.error };
}

const bin = (name: string) => join(root, "node_modules/.bin", name);

function checkNode(): Result {
  const range = pkg.engines?.node ?? ">=24";
  const version = process.version;
  if (satisfiesMinimum(version, range)) return { status: "ok", message: `Node ${version} (wants ${range})` };
  const major = range.replace(/^>=\s*/, "").split(".")[0];
  return {
    status: "fail",
    message: `Node ${version}, but package.json wants ${range}`,
    fix: `Install Node ${major} or later: \`nvm install ${major} && nvm use ${major}\` (or fnm, mise, volta), then open a new shell. The scripts run TypeScript with Node's own type stripping, which older versions lack.`,
  };
}

function checkPnpm(): Result {
  const wanted = pkg.packageManager?.replace(/^pnpm@/, "");
  const found = run("pnpm", ["--version"]);
  if (!found.ok) {
    return {
      status: "fail",
      message: "pnpm isn't available",
      fix: `Run \`npm install -g pnpm@${wanted ?? "latest"}\` (Node 26 ships without Corepack).`,
    };
  }
  const version = found.out.split("\n").at(-1) ?? found.out;
  if (wanted && version !== wanted) {
    const compatible = satisfiesMinimum(version, `>=${wanted.split(".")[0]}`);
    return {
      status: compatible ? "warn" : "fail",
      message: `pnpm ${version} (package.json pins ${wanted})`,
      fix: `Run \`npm install -g pnpm@${wanted}\`.`,
    };
  }
  return { status: "ok", message: `pnpm ${version}` };
}

function checkInstalled(): Result {
  if (existsSync(join(root, "node_modules/.modules.yaml"))) return { status: "ok", message: "dependencies installed" };
  return { status: "fail", message: "node_modules is missing", fix: "Run `pnpm install`." };
}

async function checkBrowser(): Promise<Result> {
  const custom = browserPath();
  const options = launchOptions();
  let executable = custom;
  if (custom) {
    try {
      accessSync(custom, constants.X_OK);
    } catch {
      return {
        status: "fail",
        message: `${BROWSER_ENV}=${custom} isn't an executable file`,
        fix: `Point ${BROWSER_ENV} at a Chromium binary (\`which chromium chromium-browser google-chrome\`), or unset it and run \`pnpm exec playwright install chromium-headless-shell\`.`,
      };
    }
  } else {
    executable = chromium.executablePath();
    if (!existsSync(executable)) {
      return {
        status: "fail",
        message: "Playwright's Chromium isn't installed",
        fix: `Run \`pnpm exec playwright install chromium-headless-shell\`. If the download is blocked, use an existing Chromium instead: \`export ${BROWSER_ENV}=/path/to/chromium\` (pnpm screenshots and pnpm test:e2e both read it).`,
      };
    }
  }
  try {
    const browser = await chromium.launch({ ...options, timeout: 20_000 });
    const version = browser.version();
    await browser.close();
    return { status: "ok", message: `Chromium ${version}${custom ? ` (from ${BROWSER_ENV})` : ""}` };
  } catch (error) {
    const first = String(error instanceof Error ? error.message : error).split("\n")[0];
    return {
      status: "fail",
      message: `Chromium at ${executable} doesn't start: ${first}`,
      fix: custom
        ? `Try another binary in ${BROWSER_ENV}, or unset it and run \`pnpm exec playwright install chromium-headless-shell\`. On Linux, \`pnpm exec playwright install-deps chromium\` adds missing system libraries.`
        : "Run `pnpm exec playwright install chromium-headless-shell` again (the installed build may not match @playwright/test), or set SPAGHETTI_BROWSER to an existing Chromium.",
    };
  }
}

function checkWrangler(): Result {
  if (!existsSync(bin("wrangler")))
    return { status: "fail", message: "wrangler isn't installed", fix: "Run `pnpm install`." };
  const wrangler = run(bin("wrangler"), ["--version"]);
  if (!wrangler.ok) {
    return {
      status: "fail",
      message: "wrangler doesn't run",
      fix: `Run \`pnpm install\` again. Output: ${wrangler.out.split("\n")[0]}`,
    };
  }
  // workerd is the binary that runs the Worker; pnpm 12 only builds/links it if allowed in pnpm-workspace.yaml.
  try {
    // pnpm keeps each package's dependencies beside its real location, so resolve from there.
    const fromWrangler = createRequire(realpathSync(join(root, "node_modules/wrangler/package.json")));
    const fromMiniflare = createRequire(fromWrangler.resolve("miniflare/package.json"));
    const workerd = join(dirname(fromMiniflare.resolve("workerd/package.json")), "bin/workerd");
    const result = run(workerd, ["--version"], 20_000);
    if (!result.ok) throw new Error(result.out);
    return { status: "ok", message: `wrangler ${wrangler.out.split("\n").at(-1)}, ${result.out.split("\n")[0]}` };
  } catch (error) {
    return {
      status: "fail",
      message: `workerd doesn't run: ${String(error instanceof Error ? error.message : error).split("\n")[0]}`,
      fix: "Run `pnpm install`; pnpm 12 only runs build scripts listed under allowBuilds in pnpm-workspace.yaml (esbuild, workerd). On Linux workerd needs glibc 2.35 or later.",
    };
  }
}

function checkLocalDatabase(): Result {
  const dir = process.env.SPAGHETTI_STATE_DIR ?? join(root, ".wrangler/state");
  if (!existsSync(join(dir, "v3/d1"))) {
    return {
      status: "ok",
      message: `no local database yet (${dir.replace(`${root}/`, "")}); \`pnpm dev\` creates and migrates it`,
    };
  }
  const args = ["--local", ...(process.env.SPAGHETTI_STATE_DIR ? ["--persist-to", dir] : [])];
  const pending = run(bin("wrangler"), ["d1", "migrations", "list", "DB", ...args]);
  if (!pending.ok) {
    return {
      status: "fail",
      message: "the local database can't be read",
      fix: `Delete ${dir.replace(`${root}/`, "")} and run \`pnpm dev\` (it recreates and migrates the database). Output: ${pending.out.split("\n").at(-1)}`,
    };
  }
  if (!/no migrations to apply/i.test(pending.out)) {
    return {
      status: "warn",
      message: "the local database has migrations to apply",
      fix: "Run `pnpm db:migrate` (`pnpm dev` does it too).",
    };
  }
  const users = run(bin("wrangler"), [
    "d1",
    "execute",
    "DB",
    ...args,
    "--json",
    "--command",
    "SELECT count(*) AS n FROM users",
  ]);
  const count = users.ok
    ? (JSON.parse(users.out) as Array<{ results: Array<{ n: number }> }>)[0]?.results[0]?.n
    : undefined;
  if (count === 0) {
    return {
      status: "warn",
      message: "the local database is migrated but has no people, so nobody can sign in",
      fix: "Run `pnpm user:add` once for each person, or `pnpm dev:seed` for a database with the screenshot data (alex and sam).",
    };
  }
  return { status: "ok", message: `local database migrated, ${count ?? "some"} people` };
}

function checkGit(): Result {
  const git = run("git", ["--version"]);
  return git.ok
    ? { status: "ok", message: git.out }
    : {
        status: "warn",
        message: "git isn't available",
        fix: "Install git; `pnpm screenshots:compare` needs it to check out main.",
      };
}

const checks: Array<[string, () => Result | Promise<Result>]> = [
  ["Node", checkNode],
  ["pnpm", checkPnpm],
  ["Dependencies", checkInstalled],
  ["Browser", checkBrowser],
  ["Wrangler", checkWrangler],
  ["Local database", checkLocalDatabase],
  ["Git", checkGit],
];

const icons: Record<Status, string> = { ok: "✓", warn: "!", fail: "✗" };
let failed = 0;
let warned = 0;
for (const [name, check] of checks) {
  let result: Result;
  try {
    result = await check();
  } catch (error) {
    result = { status: "fail", message: String(error instanceof Error ? error.message : error) };
  }
  if (result.status === "fail") failed++;
  if (result.status === "warn") warned++;
  console.log(`${icons[result.status]} ${name}: ${result.message}`);
  if (result.fix) console.log(`    → ${result.fix}`);
}
console.log(
  failed
    ? `\n${failed} problem${failed === 1 ? "" : "s"} to fix.`
    : warned
      ? `\nReady, with ${warned} warning${warned === 1 ? "" : "s"}.`
      : "\nAll good.",
);
process.exit(failed ? 1 : 0);
