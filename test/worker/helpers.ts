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
  await env.DB.batch([env.DB.prepare("DELETE FROM sessions"), env.DB.prepare("DELETE FROM users")]);
}
