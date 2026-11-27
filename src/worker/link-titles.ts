import { and, eq, inArray } from "drizzle-orm";
import { leadingLink } from "../shared/item-name.ts";
import { linkName } from "../shared/link-name.ts";
import { checkLinkUrl } from "../shared/link-safety.ts";
import { modelMarkOf } from "../shared/model-mark.ts";
import type { Db } from "./db/index.ts";
import { linkPreviews } from "./db/schema.ts";

/** D1 takes at most 100 bound values in a query. */
const CHUNK = 90;

/**
 * The addresses a link's preview may be kept under: as /api/links/preview keys it (the link as pasted, or a model
 * card's cleaned address) and as a draft stores it (the model page's own address).
 */
function previewKeys(url: string): string[] {
  const mark = modelMarkOf(url);
  const keys = [url, mark?.kind === "page" ? mark.url : null].flatMap((raw) => {
    const href = raw ? checkLinkUrl(raw)?.href : undefined;
    return href ? [href] : [];
  });
  return [...new Set(keys)];
}

/**
 * What the link each untitled thing's note starts with is called (`Item.linkTitle`, what shared/item-name.ts names it
 * by): its page's title from the previews the Worker has kept, else what its address says (shared/link-name.ts).
 * Things with a title, with no leading link, or whose link says nothing, are left out.
 */
export async function linkTitles(
  db: Db,
  rows: ReadonlyArray<{ id: string; title: string | null; note: string }>,
): Promise<Map<string, string>> {
  const wanted = new Map<string, { link: string; keys: string[] }>();
  for (const row of rows) {
    if (row.title?.trim()) continue;
    const link = leadingLink(row.note);
    if (link) wanted.set(row.id, { link, keys: previewKeys(link) });
  }
  if (!wanted.size) return new Map();
  const keys = [...new Set([...wanted.values()].flatMap((entry) => entry.keys))];
  const found = new Map<string, string>();
  for (let i = 0; i < keys.length; i += CHUNK) {
    const previews = await db
      .select({ url: linkPreviews.url, title: linkPreviews.title })
      .from(linkPreviews)
      .where(and(inArray(linkPreviews.url, keys.slice(i, i + CHUNK)), eq(linkPreviews.failed, false)));
    for (const preview of previews) if (preview.title?.trim()) found.set(preview.url, preview.title.trim());
  }
  const titles = new Map<string, string>();
  for (const [id, { link, keys: urls }] of wanted) {
    const title = linkName(link, urls.map((url) => found.get(url)).find(Boolean));
    if (title) titles.set(id, title);
  }
  return titles;
}
