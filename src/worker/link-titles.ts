import { and, eq, inArray } from "drizzle-orm";
import { leadingLink } from "../shared/item-name.ts";
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
 * The page title of the link each untitled thing's note starts with, from the previews the Worker has kept
 * (`Item.linkTitle`): what shared/item-name.ts names it by. Things with a title, or with no leading link, or whose
 * page was never read, are left out.
 */
export async function linkTitles(
  db: Db,
  rows: ReadonlyArray<{ id: string; title: string | null; note: string }>,
): Promise<Map<string, string>> {
  const wanted = new Map<string, string[]>();
  for (const row of rows) {
    if (row.title?.trim()) continue;
    const link = leadingLink(row.note);
    if (link) wanted.set(row.id, previewKeys(link));
  }
  const keys = [...new Set([...wanted.values()].flat())];
  if (!keys.length) return new Map();
  const found = new Map<string, string>();
  for (let i = 0; i < keys.length; i += CHUNK) {
    const previews = await db
      .select({ url: linkPreviews.url, title: linkPreviews.title })
      .from(linkPreviews)
      .where(and(inArray(linkPreviews.url, keys.slice(i, i + CHUNK)), eq(linkPreviews.failed, false)));
    for (const preview of previews) if (preview.title?.trim()) found.set(preview.url, preview.title.trim());
  }
  const titles = new Map<string, string>();
  for (const [id, urls] of wanted) {
    const title = urls.map((url) => found.get(url)).find(Boolean);
    if (title) titles.set(id, title);
  }
  return titles;
}
