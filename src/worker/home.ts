import { SESSION_COOKIE } from "./auth/session.ts";
import { setPageHeaders } from "./page-headers.ts";

const signedInCookie = new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=[^;]`);

/**
 * spaghetti.day/ is two pages: the app for someone signed in on this browser, and the landing page (landing.html,
 * src/landing) for everyone else. Only the session cookie's presence is checked, not the session, so the page costs
 * no database read: a cookie that has expired opens the app, which sends its owner to sign in like any of its pages.
 * The Home Screen app starts at /today and never comes here; deep links (/builds/…) are the app's as before.
 *
 * /?shell is the app for anyone: the service worker fetches its offline shell there (src/sw/sw.js). It can't use an
 * app route like /today, because on Cloudflare the assets' single-page fallback answers only navigations, and its
 * fetch would reach the Worker's 404.
 */
export async function home(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const app = url.searchParams.has("shell") || signedInCookie.test(request.headers.get("Cookie") ?? "");
  const page = new Request(new URL(app ? "/" : "/landing", url), request);
  const response = await env.ASSETS.fetch(page);
  const headers = new Headers(response.headers);
  // The same address answers two ways, so no cache may keep one for the other.
  headers.set("Cache-Control", "private, no-cache");
  headers.append("Vary", "Cookie");
  setPageHeaders(headers);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
