import { readFileSync } from "node:fs";
import { chromium, request } from "@playwright/test";
import { SEED_USERS, seedThrowawayState, startDevServer } from "./lib/local-app.ts";
import { SEED_BUILD_IDS, seedBuilds } from "./seed/builds.ts";
import { seedIdeas } from "./seed/ideas.ts";
import { seedPantry } from "./seed/pantry.ts";

const state = await seedThrowawayState();
const server = await startDevServer({ port: 5292, stateDir: state.dir });
const jpg = readFileSync("e2e/fixtures/tugboat.jpg");
const headers = { Origin: server.url };
const browser = await chromium.launch();
const viewports = [
  { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  { width: 1440, height: 900, deviceScaleFactor: 1.5, isMobile: false, hasTouch: false },
];

async function session(scheme: "light" | "dark", vp: (typeof viewports)[number]) {
  const { width, height, ...device } = vp;
  const ctx = await browser.newContext({ viewport: { width, height }, ...device, baseURL: server.url, colorScheme: scheme, reducedMotion: "reduce" });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
  const page = await ctx.newPage();
  await page.request.post("/api/session", { data: { username: "alex", password: SEED_USERS[0].password }, headers });
  const shot = async (name: string) => {
    await page.evaluate(async () => {
      for (const i of Array.from(document.images)) i.loading = "eager";
      await Promise.all(Array.from(document.images).map((i) => i.decode().catch(() => undefined)));
    });
    await page.waitForTimeout(700);
    await page.screenshot({ path: `screenshots/agents-${name}-${scheme}-${width}.png` });
  };
  const open = async (path: string, heading: RegExp | string) => {
    await page.goto(path, { waitUntil: "networkidle" });
    await page.getByRole("heading", { level: 1, name: heading }).first().waitFor();
  };
  return { ctx, page, shot, open, width };
}

try {
  const login = async (user: (typeof SEED_USERS)[number]) => {
    const ctx = await request.newContext({ baseURL: server.url });
    const r = await ctx.post("/api/session", { data: { username: user.username, password: user.password }, headers });
    if (!r.ok()) throw new Error("login");
    return ctx;
  };
  const [alexApi, samApi] = [await login(SEED_USERS[0]), await login(SEED_USERS[1])];
  await seedIdeas(browser, { alex: alexApi, sam: samApi }, server.url);
  await seedPantry(browser, alexApi, server.url, state.dir);
  await seedBuilds(browser, { alex: alexApi, sam: samApi }, server.url, state.dir);

  // The empty state, before any agent exists.
  for (const scheme of ["light", "dark"] as const)
    for (const vp of viewports) {
      const s = await session(scheme, vp);
      await s.open("/agents", "Agents");
      await s.page.getByRole("heading", { name: /No sous-chefs/ }).waitFor();
      await s.shot("empty");
      await s.ctx.close();
    }

  const mk = async (name: string, scopes: string[]) => (await (await alexApi.post("/api/agents", { headers, data: { name, scopes } })).json()) as { token: string };
  const claude = await mk("Claude for Alex", ["read", "capture", "attempts"]);
  const bridge = await mk("Printer bridge", ["read", "printer"]);
  const as = (t: { token: string }) => ({ Authorization: `Bearer ${t.token}` });
  const ideaId = crypto.randomUUID();
  const c = await request.newContext({ baseURL: server.url });
  await c.post("/api/items", { headers: as(claude), data: { id: ideaId, note: "Hinge for the tool drawer lid, print in place", createdAt: Date.now() - 120_000 } });
  await c.put(`/api/items/${ideaId}/photos/${crypto.randomUUID()}`, { headers: as(claude), multipart: { width: "1600", height: "1200", color: "#a08060", large: { name: "l.jpg", mimeType: "image/jpeg", buffer: jpg }, thumb: { name: "t.jpg", mimeType: "image/jpeg", buffer: jpg } } });
  const r = await c.post(`/api/items/${SEED_BUILD_IDS.tugboat}/attempts`, { headers: as(claude), data: { id: crypto.randomUUID(), outcome: "success", note: "Cooling fan up to 100%: clean overhangs this time" } });
  if (!r.ok()) throw new Error(`attempt ${r.status()}`);
  await c.get("/api/printer", { headers: as(bridge) });

  for (const scheme of ["light", "dark"] as const)
    for (const vp of viewports) {
      const s = await session(scheme, vp);
      await s.open("/ideas", "Ideas");
      await s.shot("inbox-via");
      await s.open(`/builds/${SEED_BUILD_IDS.tugboat}`, /./);
      const attempts = s.page.getByRole("list", { name: "Attempts, newest first" });
      const note = attempts.getByText("Cooling fan up to 100%").first();
      await note.waitFor();
      await note.scrollIntoViewIfNeeded();
      await s.page.evaluate(() => window.scrollBy(0, -140));
      await s.shot("build-via");
      await s.open("/journal", "Journal");
      await s.page.getByText("Cooling fan up to 100%").first().waitFor();
      await s.shot("journal-via");
      await s.open("/agents", "Agents");
      await s.page.getByRole("heading", { name: "Claude for Alex" }).waitFor();
      await s.shot("page");
      await s.page.getByRole("button", { name: "New agent" }).first().click();
      const dialog = s.page.getByRole("dialog", { name: "New agent" });
      await dialog.getByLabel("Name").fill("Home assistant");
      await dialog.getByRole("button", { name: "Capture" }).click();
      await s.shot("sheet-new");
      await s.ctx.close();
    }
  // The token, shown once (makes one more agent each time, behind the sheet).
  for (const scheme of ["light", "dark"] as const)
    for (const vp of viewports) {
      const s = await session(scheme, vp);
      await s.open("/agents", "Agents");
      await s.page.getByRole("button", { name: "New agent" }).first().click();
      const dialog = s.page.getByRole("dialog", { name: "New agent" });
      await dialog.getByLabel("Name").fill("Home assistant");
      await dialog.getByRole("button", { name: "Capture" }).click();
      await dialog.getByRole("button", { name: "Make token" }).click();
      await s.page.getByRole("dialog", { name: "Copy your token" }).waitFor();
      await s.page.getByRole("button", { name: "Copy token" }).click();
      await s.shot("sheet-token");
      await s.ctx.close();
    }
} finally {
  await browser.close();
  server.stop();
  state.cleanup();
}
