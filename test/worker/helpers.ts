import { env, exports } from "cloudflare:workers";
import { hashPassword } from "../../src/shared/password.ts";

export const ORIGIN = "http://spaghetti.test";

export function request(path: string, init: RequestInit & { json?: unknown; cookie?: string } = {}) {
  const { json, cookie, headers, ...rest } = init;
  return exports.default.fetch(
    new Request(`${ORIGIN}${path}`, {
      ...rest,
      headers: {
        Origin: ORIGIN,
        ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    }),
  );
}

export async function addUser(username: string, password: string, name = username, color = "tomato") {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO users (id, username, name, color, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(id, username, name, color, await hashPassword(password), Date.now())
    .run();
  return id;
}

/** Signs in and returns the cookie header to send with later requests. */
export async function signIn(username: string, password: string): Promise<string> {
  const response = await request("/api/session", { method: "POST", json: { username, password } });
  if (response.status !== 200) throw new Error(`Sign-in failed: ${response.status}`);
  const setCookie = response.headers.get("Set-Cookie") ?? "";
  return setCookie.split(";")[0] ?? "";
}

/** Storage is shared by the tests in a file: start each one empty. */
export async function resetDb() {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM upkeep_logs"),
    env.DB.prepare("DELETE FROM upkeep_tasks"),
    env.DB.prepare("DELETE FROM push_nudges"),
    env.DB.prepare("DELETE FROM push_subscriptions"),
    env.DB.prepare("DELETE FROM agent_tokens"),
    env.DB.prepare("DELETE FROM agents"),
    env.DB.prepare("DELETE FROM changes"),
    env.DB.prepare("DELETE FROM sqlite_sequence WHERE name = 'changes'"),
    env.DB.prepare("DELETE FROM attempt_files"),
    env.DB.prepare("DELETE FROM ams_slots"),
    env.DB.prepare("DELETE FROM spool_weighings"),
    env.DB.prepare("DELETE FROM spools"),
    env.DB.prepare("DELETE FROM printer"),
    env.DB.prepare("DELETE FROM bridge"),
    env.DB.prepare("DELETE FROM photos"),
    env.DB.prepare("DELETE FROM attempts"),
    env.DB.prepare("DELETE FROM recipes"),
    env.DB.prepare("DELETE FROM tags"),
    env.DB.prepare("DELETE FROM draft_runs"),
    env.DB.prepare("DELETE FROM item_drafts"),
    env.DB.prepare("DELETE FROM items"),
    env.DB.prepare("DELETE FROM password_failures"),
    env.DB.prepare("DELETE FROM sessions"),
    env.DB.prepare("DELETE FROM users"),
  ]);
}

/** Uploads a photo's two variants the way the browser does. */
export function uploadPhoto(
  itemId: string,
  photoId: string,
  cookie: string,
  fields: Record<string, string> = {},
  type = "image/webp",
) {
  const form = new FormData();
  form.set("width", "2048");
  form.set("height", "1536");
  form.set("color", "#A08060");
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  form.set("large", new File([new Uint8Array([1, 2, 3, 4])], "large.webp", { type }));
  form.set("thumb", new File([new Uint8Array([5, 6])], "thumb.webp", { type }));
  return request(`/api/items/${itemId}/photos/${photoId}`, { method: "PUT", body: form, cookie });
}
