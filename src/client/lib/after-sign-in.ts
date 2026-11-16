const HOME = "/today";
/** Pages about signing in: going on to one of them after signing in would loop. */
const SIGNING_IN = new Set(["/sign-in", "/link", "/join"]);

/**
 * Where signing in goes on to: the page that sent the person to sign in (the `redirect` of /sign-in and /link), when it
 * is one of this app's own pages, else home. Only a path on this origin that a route answers counts, so a crafted link
 * can't send anyone elsewhere (`//host`, `/\host`, `https:`, `javascript:`) and an address the app doesn't know lands
 * on home rather than on a not-found page. `knows` is the router's own matching (RouterContext.knows).
 */
export function afterSignIn(target: string | undefined, knows: (pathname: string) => boolean): string {
  // Browsers read a backslash as a slash and drop tabs and newlines, so "/\evil.example" would leave the site.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this rejects
  if (!target?.startsWith("/") || target.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(target)) return HOME;
  let url: URL;
  try {
    url = new URL(target, window.location.origin);
  } catch {
    return HOME;
  }
  if (url.origin !== window.location.origin || SIGNING_IN.has(url.pathname) || !knows(url.pathname)) return HOME;
  return url.pathname + url.search + url.hash;
}
