import { expect, type Page, test } from "@playwright/test";
import { SEED_PASSWORD, SEED_USERS } from "../scripts/lib/local-app.ts";
import { signIn } from "./helpers";

const REDIRECT = "http://127.0.0.1:53682/callback";

const b64url = (bytes: ArrayBuffer | Uint8Array) =>
  Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString("base64url");

/** What Claude does first: registers itself, then sends the person to /authorize with a PKCE challenge. */
async function startConnection(page: Page, scope = "read capture") {
  const registered = await page.request.post("/oauth/register", {
    data: { client_name: "Claude", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none" },
  });
  expect(registered.status()).toBe(201);
  const { client_id: clientId } = await registered.json();
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope,
    state: "xyz",
  });
  return { clientId, verifier, path: `/authorize?${query}` };
}

/** Disconnects every connected app, so the next test starts clean. */
async function disconnectAll(page: Page) {
  const origin = new URL(page.url()).origin;
  const response = await page.request.get("/api/agents");
  if (!response.ok()) return;
  const { agents } = await response.json();
  for (const agent of agents)
    if (agent.connection?.connected)
      await page.request.delete(`/api/agents/${agent.id}/connection`, { headers: { Origin: origin } });
}

test.afterEach(async ({ page }) => {
  await disconnectAll(page);
});

test("signed out, the sign-in comes first and leads straight back to the consent screen", async ({ page }) => {
  const connection = await startConnection(page);
  await page.goto(connection.path);
  await expect(page).toHaveURL(/\/sign-in\?redirect=/);
  await page.getByLabel("Name").fill(SEED_USERS[0].username);
  await page.getByLabel("Password", { exact: true }).fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Claude wants to connect" })).toBeVisible();
});

test("shows who asks and what it can do, and Allow hands the app a code that becomes working tokens", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await signIn(page);
  const connection = await startConnection(page);
  await page.goto(connection.path);

  await expect(page.getByRole("heading", { name: "Claude wants to connect" })).toBeVisible();
  await expect(page.getByText("Then it returns you to 127.0.0.1:53682")).toBeVisible();
  const scopes = page.getByRole("list").filter({ hasText: "See everything" });
  await expect(scopes.getByRole("listitem")).toHaveCount(2);
  await expect(scopes).toContainText("Add ideas, notes and photos.");
  await expect(scopes).not.toContainText("Load AMS slots");

  let callback = "";
  await page.route("http://127.0.0.1:53682/**", (route) => {
    callback = route.request().url();
    return route.fulfill({ status: 200, contentType: "text/html", body: "<p>Claude</p>" });
  });
  await page.getByRole("button", { name: "Allow" }).click();
  await expect.poll(() => callback).toContain("code=spc_");
  const url = new URL(callback);
  expect(url.searchParams.get("state")).toBe("xyz");

  const tokens = await page.request.post("/oauth/token", {
    form: {
      grant_type: "authorization_code",
      code: url.searchParams.get("code") as string,
      code_verifier: connection.verifier,
      client_id: connection.clientId,
      redirect_uri: REDIRECT,
    },
  });
  expect(tokens.status()).toBe(200);
  const { access_token: access } = await tokens.json();
  const tools = await page.request.post("/mcp", {
    headers: { Authorization: `Bearer ${access}` },
    data: { jsonrpc: "2.0", id: 1, method: "tools/list" },
  });
  expect(tools.status()).toBe(200);

  // It is an agent of this person now, on the Agents page, and Disconnect ends it with an undo first.
  await page.goto("/agents");
  const card = page
    .getByRole("list", { name: "Your agents" })
    .getByRole("listitem")
    .filter({ hasText: "Signed in with Claude" });
  await expect(card.getByRole("heading", { name: /^Claude for / })).toBeVisible();
  await expect(card.getByText(/Signed in with Claude/)).toBeVisible();
  await expect(card.getByText("Read", { exact: true })).toBeVisible();
  await expect(card.getByText("Printer", { exact: true })).toHaveCount(0);

  await card.getByRole("button", { name: /^Disconnect/ }).click();
  await expect(page.getByText("App disconnected")).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(card.getByText("Disconnected")).toHaveCount(0);
  await card.getByRole("button", { name: /^Disconnect/ }).click();
  await expect(page.getByText("App disconnected").last()).toBeVisible();
  const call = () =>
    page.request
      .post("/mcp", {
        headers: { Authorization: `Bearer ${access}` },
        data: { jsonrpc: "2.0", id: 1, method: "ping" },
      })
      .then((response) => response.status());
  expect(await call()).toBe(200);
  await expect.poll(call, { timeout: 15_000 }).toBe(401);
  await expect(card).toHaveCount(0);
});

test("Not now sends the person back with access_denied, and a broken link says so without leaving", async ({
  page,
}) => {
  await signIn(page);
  const connection = await startConnection(page);
  await page.goto(connection.path);
  let callback = "";
  await page.route("http://127.0.0.1:53682/**", (route) => {
    callback = route.request().url();
    return route.fulfill({ status: 200, contentType: "text/html", body: "<p>Claude</p>" });
  });
  await page.getByRole("button", { name: "Not now" }).click();
  await expect.poll(() => callback).toContain("error=access_denied");
  expect(callback).not.toContain("code=");

  await page.goto(`${connection.path}&redirect_uri=${encodeURIComponent("https://evil.example/cb")}`);
  await expect(page.getByRole("heading", { name: "That link doesn't look right" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Allow" })).toHaveCount(0);
});
