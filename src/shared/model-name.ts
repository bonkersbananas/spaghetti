/** A model's name from its address (decision 0071): small enough for the client's first load. */

/** Words Printables' slugs spell in lower case that people write otherwise. Only what is cheap and certain. */
const BRAND_WORDS: Record<string, string> = {
  ikea: "IKEA",
  usb: "USB",
  led: "LED",
  pla: "PLA",
  petg: "PETG",
  tpu: "TPU",
  abs: "ABS",
  diy: "DIY",
  ams: "AMS",
  rgb: "RGB",
  pcb: "PCB",
  hdmi: "HDMI",
  lego: "LEGO",
  bambu: "Bambu",
};

/** A title is a few words: a longer slug is cut at a word. */
const SLUG_TITLE_MAX = 60;

/**
 * A name for a Printables model from its address alone, for when the page can't be read (decision 0071):
 * `/model/1577248-carrying-handle-for-ikea-antilop` is "Carrying handle for IKEA antilop". Null without a slug
 * (`/model/1577248`), for another site, or when nothing readable is left.
 */
export function printablesTitleFromLink(link: string): string | null {
  if (!URL.canParse(link) || !/(^|\.)printables\.com$/i.test(new URL(link).hostname)) return null;
  const slug = /^\/(?:[a-z]{2}\/)?model\/\d{1,12}-([^/?#]+)/i.exec(new URL(link).pathname)?.[1];
  if (!slug) return null;
  let text = slug;
  try {
    text = decodeURIComponent(slug);
  } catch {
    // A stray % stays as it is.
  }
  const words = text
    .split(/[^\p{L}\p{N}']+|_+/u)
    .map((word) => word.replace(/^'+|'+$/g, ""))
    .filter(Boolean);
  if (!words.length) return null;
  let title = "";
  for (const [index, word] of words.entries()) {
    const lower = word.toLowerCase();
    // IKEA's product names are capitalised words ("IKEA Antilop"), whatever else the slug says.
    const capital = index === 0 || words[index - 1]?.toLowerCase() === "ikea";
    const shown =
      (Object.hasOwn(BRAND_WORDS, lower) ? BRAND_WORDS[lower] : undefined) ??
      (capital ? word.charAt(0).toUpperCase() + word.slice(1) : word);
    const next = title ? `${title} ${shown}` : shown;
    if (next.length > SLUG_TITLE_MAX) break;
    title = next;
  }
  return title || null;
}
