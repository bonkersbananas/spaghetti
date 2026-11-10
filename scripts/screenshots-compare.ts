/**
 * pnpm screenshots:compare — takes every screenshot on main and on your
 * branch, writes a diff image for each screen that changed, and builds
 * contact sheets: one image per width and theme with every screen small and
 * labeled; changed screens are outlined. Publish the contact sheet and the
 * changed screens (before, after and diff in one picture) with `fctl publish`.
 *
 *   pnpm screenshots:compare                  # origin/main against the working tree, light and dark
 *   pnpm screenshots:compare --base abc1234   # against another commit or branch
 *   pnpm screenshots:compare --light          # light only (--dark: dark only)
 *   pnpm screenshots:compare ideas capture    # only these screens
 *   pnpm screenshots:compare --scale 2        # sharper pictures (default 1: pages up to 9000 px tall stay small)
 *   pnpm screenshots:compare --out DIR        # default ./screenshots/compare
 *
 * Output in the folder:
 *   contact/contact-390.png, contact-390-dark.png, …   every screen, small
 *   changed/<screen>-<width>[-dark].png                before | after | diff, cropped to the change
 *   diff/<screen>-<width>[-dark].png                   the diff alone
 *   base/ and head/                                    the full screenshots (don't publish these)
 *   summary.md                                         what changed, and the fctl publish command
 *
 * The base is checked out in a temporary git worktree with this branch's
 * scripts (so the screens, the seed and the options match) over main's
 * source. A screen the base can't take (it doesn't exist there yet) counts as
 * new. The seed's date and the browser's clock are fixed, so unchanged
 * screens come out pixel-identical.
 */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { chromium } from "@playwright/test";
import { launchOptions } from "./lib/browser.ts";
import { type DiffResult, type Encoded, installImageTools, type Tile, type TileStatus } from "./lib/image-tools.ts";
import { root } from "./lib/wrangler.ts";

const argv = process.argv.slice(2);
const valueOptions = ["--base", "--out", "--scale"];
const option = (name: string) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};
const names = argv.filter((arg, index) => !arg.startsWith("--") && !valueOptions.includes(argv[index - 1] ?? ""));
const themes: Array<"light" | "dark"> = argv.includes("--light")
  ? ["light"]
  : argv.includes("--dark")
    ? ["dark"]
    : ["light", "dark"];
const scale = Number(option("--scale") ?? 1);
if (!(scale > 0)) throw new Error("--scale needs a number such as 1 or 2.");
const out = resolve(option("--out") ?? join(root, "screenshots/compare"));

const git = (args: string[], cwd = root) => {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed:\n${result.stderr}`);
  return result.stdout.trim();
};
const ref =
  option("--base") ??
  (spawnSync("git", ["rev-parse", "--verify", "-q", "origin/main"], { cwd: root }).status === 0
    ? "origin/main"
    : "main");
const baseSha = git(["rev-parse", "--short", ref]);
const headBranch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
const headSha = git(["rev-parse", "--short", "HEAD"]);
const dirty = git(["status", "--porcelain"]) !== "";
const baseLabel = `Before: ${ref} ${baseSha}`;
const headLabel = `After: ${headBranch} ${headSha}${dirty ? " + uncommitted" : ""}`;

rmSync(out, { recursive: true, force: true });
for (const dir of ["base", "head", "diff", "changed", "contact"]) mkdirSync(join(out, dir), { recursive: true });

// The base: main's source in a worktree, with this branch's scripts and fixtures over it.
const worktree = mkdtempSync(join(tmpdir(), "spaghetti-base-"));
rmSync(worktree, { recursive: true });
console.log(`Checking out ${ref} (${baseSha}) in ${worktree}`);
git(["worktree", "add", "--detach", worktree, ref]);

/** Takes the base worktree (with its node_modules, hundreds of MB) away. Safe to call twice. */
let cleaned = false;
function removeWorktree() {
  if (cleaned) return;
  cleaned = true;
  spawnSync("git", ["worktree", "remove", "--force", worktree], { cwd: root });
  rmSync(worktree, { recursive: true, force: true });
  spawnSync("git", ["worktree", "prune"], { cwd: root });
}
// Whatever ends the run, the worktree goes: a normal end or a failure (the finally below), the process exiting,
// or being stopped (Ctrl-C, a kill). A run stopped that way also stops the screenshot run it started.
let running: ChildProcess | undefined;
process.on("exit", removeWorktree);
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => {
    running?.kill("SIGTERM");
    removeWorktree();
    process.exit(128 + (signal === "SIGINT" ? 2 : signal === "SIGTERM" ? 15 : 1));
  });
}
try {
  cpSync(join(root, "scripts"), join(worktree, "scripts"), { recursive: true });
  cpSync(join(root, "e2e/fixtures"), join(worktree, "e2e/fixtures"), { recursive: true });
  console.log("Installing the base's dependencies (from the shared store)…");
  const install = spawnSync("pnpm", ["install", "--frozen-lockfile", "--prefer-offline"], {
    cwd: worktree,
    encoding: "utf8",
  });
  if (install.status !== 0)
    throw new Error(`pnpm install in the base worktree failed:\n${install.stdout}${install.stderr}`);

  console.log(`Taking screenshots on the base and on this branch (${themes.join(" and ")})…`);
  const flags = [
    themes.length === 2 ? "--both" : themes[0] === "dark" ? "--dark" : "",
    "--scale",
    String(scale),
    ...names,
  ].filter(Boolean);
  // One after the other: two dev servers can't share workerd's inspector port.
  const baseRun = await run("base", worktree, [...flags, "--out", join(out, "base")], 5301);
  const headRun = await run("head", root, [...flags, "--out", join(out, "head")], 5302);
  if (baseRun.code !== 0) console.log(`  (the base had failures: those screens count as new if the branch took them)`);
  if (headRun.code !== 0) console.log(`  (this branch had failures: see above)`);
} finally {
  removeWorktree();
}

interface Screen {
  name: string;
  width: number;
  theme: "light" | "dark";
  /** The file name stem: ideas-dark-390. */
  stem: string;
  status: TileStatus;
  percent?: number;
  result?: DiffResult;
}

const pattern = /^(.+?)(-dark)?-(\d+)\.png$/;
const parse = (dir: string) =>
  new Map(
    readdirSync(join(out, dir)).flatMap((file) => {
      const match = pattern.exec(file);
      return match
        ? [
            [
              file.replace(/\.png$/, ""),
              { name: match[1] as string, theme: match[2] ? "dark" : "light", width: Number(match[3]) },
            ] as const,
          ]
        : [];
    }),
  );
const baseFiles = parse("base");
const headFiles = parse("head");
const { shots } = await import("./screenshot-routes.ts");
const expected = shots
  .filter((shot) => !names.length || names.includes(shot.name))
  .flatMap((shot) =>
    [390, 1440]
      .filter((width) => !shot.width || shot.width === width)
      .flatMap((width) =>
        themes.map((theme) => ({
          name: shot.name,
          width,
          theme,
          stem: `${shot.name}${theme === "dark" ? "-dark" : ""}-${width}`,
        })),
      ),
  );

const browser = await chromium.launch(launchOptions());
const page = await browser.newPage();
// Serve the screenshot files to the page, so canvas can read them same-origin.
await page.route("http://images.local/**", async (route) => {
  const path = new URL(route.request().url()).searchParams.get("f");
  if (!path) return route.abort();
  return route.fulfill({ body: readFileSync(path), contentType: "image/png" });
});
await page.route("http://images.local/", (route) =>
  route.fulfill({ body: "<!doctype html><title>images</title>", contentType: "text/html" }),
);
await page.goto("http://images.local/");
await page.evaluate(installImageTools);
const url = (dir: string, stem: string) =>
  `http://images.local/img?f=${encodeURIComponent(join(out, dir, `${stem}.png`))}`;
const save = (path: string, encoded: Encoded) => {
  const file = `${path}.${encoded.ext}`;
  writeFileSync(file, Buffer.from(encoded.data, "base64"));
  return relative(root, file);
};

const screens: Screen[] = [];
const published: string[] = [];
for (const item of expected) {
  const inBase = baseFiles.has(item.stem);
  const inHead = headFiles.has(item.stem);
  const screen: Screen = { ...item, status: inHead ? (inBase ? "same" : "new") : inBase ? "removed" : "failed" };
  if (inBase && inHead) {
    const result = await page.evaluate((options) => window.imageTools.compare(options), {
      baseUrl: url("base", item.stem),
      headUrl: url("head", item.stem),
      baseLabel,
      headLabel,
      stacked: item.width > 800,
      maxRows: item.width > 800 ? 900 : 1800,
    });
    screen.result = result;
    if (result.changed) {
      screen.status = "changed";
      screen.percent = result.percent;
      if (result.diff) save(join(out, "diff", item.stem), result.diff);
      if (result.panel) published.push(save(join(out, "changed", item.stem), result.panel));
    }
  }
  screens.push(screen);
}

// One contact sheet per width and theme, showing the branch's screens.
const sheets: string[] = [];
for (const theme of themes) {
  for (const width of [390, 1440]) {
    const group = screens.filter((screen) => screen.width === width && screen.theme === theme);
    if (!group.length) continue;
    const tiles: Tile[] = group.map((screen) => ({
      label: screen.name,
      status: screen.status,
      percent: screen.percent,
      url:
        screen.status === "removed"
          ? url("base", screen.stem)
          : screen.status === "failed"
            ? undefined
            : url("head", screen.stem),
    }));
    const changed = group.filter((screen) => screen.status !== "same").length;
    const title = `Spaghetti at ${width} px, ${theme}: ${changed ? `${changed} of ${group.length} screens differ from ${ref}` : `${group.length} screens, none differ from ${ref}`}`;
    const encoded = await page.evaluate((options) => window.imageTools.sheet(options), {
      title,
      tiles,
      tileWidth: width === 390 ? 240 : 440,
      columns: width === 390 ? 6 : 4,
      maxTileHeight: width === 390 ? 480 : 320,
    });
    sheets.push(save(join(out, "contact", `contact-${width}${theme === "dark" ? "-dark" : ""}`), encoded));
  }
}
await browser.close();

const by = (status: TileStatus) => screens.filter((screen) => screen.status === status);
const list = (status: TileStatus) =>
  by(status)
    .map(
      (screen) =>
        `- ${screen.stem}${screen.percent !== undefined ? ` (${screen.percent.toFixed(screen.percent < 1 ? 2 : 1)}% of the pixels${screen.result?.sizeChanged ? `, ${screen.result.baseSize.join("×")} → ${screen.result.headSize.join("×")}` : ""})` : ""}`,
    )
    .join("\n");
const sections = (["changed", "new", "removed", "failed"] as const).flatMap((status) =>
  by(status).length
    ? [
        `## ${{ changed: "Changed", new: "New (not on the base)", removed: "Missing on this branch", failed: "Failed on both" }[status]}\n\n${list(status)}`,
      ]
    : [],
);
const unchanged = by("same").length;
const command = `fctl publish ${[...sheets, ...published.slice(0, 12)].join(" ")}`;
const summary = [
  `# Screenshots: ${headBranch} against ${ref}`,
  `${screens.length} screens: ${unchanged} unchanged, ${by("changed").length} changed, ${by("new").length} new, ${by("removed").length} missing, ${by("failed").length} failed.`,
  ...sections,
  `## To publish\n\nPut the contact sheets and the changed screens in the pull request description, and say what each shows:\n\n\`\`\`sh\n${command}\n\`\`\``,
].join("\n\n");
writeFileSync(join(out, "summary.md"), `${summary}\n`);
console.log(`\n${summary}\n\nEverything is in ${relative(root, out)}/ (summary.md has this).`);
process.exitCode = by("failed").length || by("removed").length ? 1 : 0;

/** Runs `node scripts/screenshots.ts` in a tree, streaming its output with a prefix. */
function run(prefix: string, cwd: string, args: string[], port: number): Promise<{ code: number }> {
  return new Promise((resolveRun) => {
    const child: ChildProcess = spawn("node", ["scripts/screenshots.ts", ...args], {
      cwd,
      env: { ...process.env, SCREENSHOT_PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    for (const stream of [child.stdout, child.stderr]) {
      let pending = "";
      stream?.on("data", (chunk) => {
        pending += chunk;
        const lines = pending.split("\n");
        pending = lines.pop() ?? "";
        for (const line of lines) if (/✗|failed|Error/.test(line)) console.log(`  [${prefix}] ${line.trim()}`);
      });
    }
    running = child;
    child.on("close", (code) => {
      running = undefined;
      resolveRun({ code: code ?? 1 });
    });
  });
}
