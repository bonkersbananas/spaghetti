import { expect, type Page, test } from "@playwright/test";
import { hotdogModel } from "./fixtures/model-3mf";
import { boxStl } from "./fixtures/model-stl";
import { clearIdeas, signIn } from "./helpers";

// Models an agent put into Spaghetti over MCP (decision 0078): no browser read them, so the first one that opens the
// app slices them quietly, as it resizes an agent's photos (photo-resize.spec.ts).
const origin = (page: Page) => new URL(page.url()).origin;
const SLICED = 90_000;

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test.afterEach(async ({ page }) => {
  await clearIdeas(page);
  const { agents } = await (await page.request.get("/api/agents")).json();
  for (const agent of agents)
    for (const token of agent.tokens)
      await page.request.delete(`/api/agents/${agent.id}/tokens/${token.id}`, { headers: { Origin: origin(page) } });
});

test("an .stl and a .3mf an agent added are sliced by the next browser that opens the app, and get their cover and 3D view", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const made = await (
    await page.request.post("/api/agents", {
      headers: { Origin: origin(page) },
      data: { name: "Claude for Alex", scopes: ["read", "capture"] },
    })
  ).json();
  const call = async (name: string, args: Record<string, unknown>) => {
    const answer = await page.request.post("/mcp", {
      headers: { Authorization: `Bearer ${made.token}` },
      data: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } },
    });
    const result = (await answer.json()).result;
    expect(result.isError, result.content[0].text).not.toBe(true);
    return result.content[0].text as string;
  };
  const idea = async (title: string) =>
    /build_id: ([0-9a-f-]{36})/.exec(await call("capture_idea", { title }))?.[1] ?? "";
  const cubeId = await idea("Agent cube");
  const hotdogId = await idea("Agent hotdog");
  await call("add_file", {
    build_id: cubeId,
    name: "cube.stl",
    file_base64: Buffer.from(boxStl(20)).toString("base64"),
  });
  await call("add_file", {
    build_id: hotdogId,
    name: "hotdog.3mf",
    file_base64: Buffer.from(hotdogModel()).toString("base64"),
  });

  const fileOf = async (id: string) => (await (await page.request.get(`/api/items/${id}`)).json()).item.files[0];
  // As it arrived: a model, nobody has sliced it.
  expect(await fileOf(cubeId)).toMatchObject({ kind: "model", slice: null, hasThumb: false });

  // Someone opens the app: with nothing to ask of them, both are sliced and their pictures drawn.
  await page.goto("/ideas");
  await expect(page.getByRole("list", { name: "Ideas" }).getByRole("link", { name: /Agent cube/ })).toBeVisible();
  for (const id of [cubeId, hotdogId]) {
    await expect.poll(async () => (await fileOf(id)).slice?.status, { timeout: SLICED }).toBe("sliced");
    expect(await fileOf(id)).toMatchObject({ hasThumb: true });
  }

  // On the idea: the card is a sliced model like any other, with its cover and 3D view.
  await page.goto(`/ideas/${cubeId}`);
  const files = page.getByRole("region", { name: /^Files/ });
  await expect(files.getByText("cube.stl")).toBeVisible();
  await expect(files.getByText(/Sliced by Spaghetti$/)).toBeVisible();
  await expect(page.getByRole("img", { name: "Slicer preview: Agent cube" })).toBeVisible();
  await files.getByRole("button", { name: "See cube.stl in 3D" }).click();
  const viewer = page.getByRole("dialog", { name: "3D view" });
  await expect(viewer.locator("[data-viewer=ready]")).toBeVisible({ timeout: 30_000 });
});
