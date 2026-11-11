/**
 * What the Worker answers for a GET that matched no static file (the assets binding has no single-page fallback,
 * wrangler.jsonc): an app route gets index.html, so deep links and reloads work; anything that names a file
 * (/assets/*, an extension) is a plain 404. Cloudflare's own fallback would answer a build's gone chunk
 * (/assets/_app-abc.js) with HTML, and a stale tab would fail with a MIME-type error instead of a clear 404 that
 * the app recovers from (lib/stale-build.ts).
 */
export async function spa(request: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(request.url);
  const last = pathname.slice(pathname.lastIndexOf("/") + 1);
  if (pathname.startsWith("/assets/") || last.includes(".")) {
    return new Response("Not found", {
      status: 404,
      // Short: a deploy that adds the file shouldn't wait out a cached miss.
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
  const page = await env.ASSETS.fetch(new Request(new URL("/", request.url), request));
  const headers = new Headers(page.headers);
  headers.set("Cache-Control", "no-cache");
  return new Response(page.body, { status: page.status, headers });
}
