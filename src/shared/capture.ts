/** Most photos one share can bring. */
export const MAX_CAPTURE_PHOTOS = 10;

/**
 * What a share becomes as an idea's note: its text, then its link. Android's share sheet often puts the
 * link inside the text already; it is not added twice.
 */
export function captureNote(text: string | null | undefined, url: string | null | undefined): string {
  const words = text?.trim() ?? "";
  const link = url?.trim() ?? "";
  if (!link) return words;
  if (!words) return link;
  return words.includes(link) ? words : `${words}\n${link}`;
}

/** A shared title that only repeats the text or the link says nothing, and is left out. */
export function captureTitle(
  title: string | null | undefined,
  text: string | null | undefined,
  url: string | null | undefined,
) {
  const t = title?.trim() ?? "";
  if (!t) return null;
  if (t === url?.trim() || t === text?.trim()) return null;
  return tidyPageTitle(t) ?? t;
}

/**
 * A page title without its site's name: "Infinity Heart | MakerWorld" is "Infinity Heart". Only a model site's name or a
 * domain goes ("Plate - 3.5mm" and "Cats | Dogs" stay).
 */
export function tidyPageTitle(title: string): string | null {
  const [, head = "", suffix = ""] = /^(.*\S)\s+[|\-–—·•]\s+([^|\-–—·•]{1,40})$/.exec(title) ?? [];
  return /^(makerworld|printables|thingiverse|thangs|cults|myminifactory|creality cloud|[\w-]+\.[a-z]{2,})$/i.test(
    suffix,
  )
    ? head
    : null;
}
