import type { SharedInput } from "./capture";

/**
 * What the share target left for the page. The service worker takes the POST (it works with no signal, too),
 * keeps the form in this cache and redirects to /share?id=…; the page reads it from here and clears it.
 * Keys: `/__share/<id>/meta` (JSON) and `/__share/<id>/<n>` for the n-th file.
 */
export const SHARE_CACHE = "sg-share";
const keyOf = (id: string, part: string | number) => `/__share/${id}/${part}`;

interface ShareMeta {
  title: string;
  text: string;
  url: string;
  files: Array<{ name: string; type: string }>;
}

/** The shared title, text, url and files for a share the service worker took, or null when it is gone. */
export async function readShare(id: string): Promise<(Required<Omit<SharedInput, "id">> & { files: File[] }) | null> {
  if (typeof caches === "undefined") return null;
  const cache = await caches.open(SHARE_CACHE);
  const meta = await cache.match(keyOf(id, "meta"));
  if (!meta) return null;
  const { title, text, url, files }: ShareMeta = await meta.json();
  const read = await Promise.all(
    files.map(async (file, index) => {
      const response = await cache.match(keyOf(id, index));
      return response ? new File([await response.blob()], file.name, { type: file.type }) : null;
    }),
  );
  return { title, text, url, files: read.filter((file): file is File => !!file) };
}

/** Forgets a share once it is safely in the outbox. */
export async function clearShare(id: string) {
  if (typeof caches === "undefined") return;
  const cache = await caches.open(SHARE_CACHE);
  for (const request of await cache.keys()) {
    if (new URL(request.url).pathname.startsWith(`/__share/${id}/`)) await cache.delete(request);
  }
}
