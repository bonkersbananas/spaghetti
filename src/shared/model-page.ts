/**
 * What a model page says about itself, read from the HTML the Worker fetched: the title, designer, license and
 * pictures it states plainly, and the text and print profiles Claude drafts the note from. Pure, so it is
 * unit-tested against real pages (test/fixtures/pages). Written against what the sites really send:
 * MakerWorld is a Next.js app whose whole design is in `__NEXT_DATA__`; Thingiverse and most others carry
 * og: tags and a JSON-LD `Product`.
 */
import type { ModelSiteId } from "./model-links.ts";

export interface PageFacts {
  title: string | null;
  designer: string | null;
  license: string | null;
  /** Picture URLs the page names, best first (real photos before renders). Not yet checked against the image allowlist. */
  imageUrls: string[];
  /** The page's own description, as plain text. */
  description: string;
  /** Print profiles the page lists, one plain line each (material, weight, time, printers). */
  profiles: string[];
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name.startsWith("#")) {
      const code = name[1]?.toLowerCase() === "x" ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
      // A page can write any number: only real code points are decoded (fromCodePoint throws above 0x10FFFF).
      return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

/** HTML (a description with <p> and <img>) as plain words. */
export function plainText(html: string, max = 3000): string {
  const text = decode(
    html
      .replace(/<(script|style|figure)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<\/(p|div|li|h\d|br)>|<br\s*\/?>/gi, "\n")
      .replace(/<[^>]*>/g, " ")
      .replace(/<[^>]*$/, " "),
  )
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

const clean = (value: unknown, max = 200): string | null => {
  if (typeof value !== "string") return null;
  const text = plainText(value, max).replace(/\s+/g, " ").trim();
  return text || null;
};

function metaContent(html: string, key: string): string | null {
  for (const tag of html.slice(0, 200_000).match(/<meta\b[^>]*>/gi) ?? []) {
    const name = /(?:property|name)=["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
    if (name !== key) continue;
    const content = /content=(?:"([^"]*)"|'([^']*)')/i.exec(tag);
    return decode(content?.[1] ?? content?.[2] ?? "") || null;
  }
  return null;
}

/** A page's resize wrapper (`resize.thingiverse.com/?url=https://cdn…/a.jpg&w=…`) as the picture inside it. */
export function unwrapImage(raw: string): string {
  try {
    const url = new URL(decode(raw));
    if (url.hostname === "resize.thingiverse.com") return url.searchParams.get("url") ?? raw;
    return url.href;
  } catch {
    return raw;
  }
}

function jsonLd(html: string): Array<Record<string, unknown>> {
  const found: Array<Record<string, unknown>> = [];
  for (const match of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data: unknown = JSON.parse(match[1] ?? "");
      for (const item of Array.isArray(data) ? data : [data]) {
        if (item && typeof item === "object") found.push(item as Record<string, unknown>);
      }
    } catch {
      // Not JSON: skip it.
    }
  }
  return found;
}

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : value ? [value] : []);
const unique = (urls: string[]) => [...new Set(urls)];

/** The standard meta tags and JSON-LD every model site has. */
function readGeneric(html: string): PageFacts {
  const ld = jsonLd(html).find((item) => /Product|CreativeWork|3DModel/i.test(String(item["@type"])));
  const named = (value: unknown) =>
    typeof value === "string" ? value : value && typeof value === "object" ? (value as { name?: unknown }).name : null;
  const license = html.match(/\\?"license\\?":\s*\\?"(https:\/\/[^"\\]+)/)?.[1] ?? clean(ld?.license);
  const images = [
    ...asArray(ld?.image).map((image) =>
      typeof image === "string" ? image : String((image as { url?: unknown })?.url ?? ""),
    ),
    metaContent(html, "og:image") ?? "",
  ]
    .filter(Boolean)
    .map(unwrapImage);
  return {
    title: clean(ld?.name ?? metaContent(html, "og:title"), 200),
    designer: clean(named(ld?.author) ?? named(ld?.brand) ?? named(ld?.creator), 120),
    license,
    imageUrls: unique(images),
    description: plainText(String(ld?.description ?? metaContent(html, "og:description") ?? "")),
    profiles: [],
  };
}

interface MakerWorldDesign {
  title?: string;
  /** The API answers in the designer's language and adds an English translation; the page is already English. */
  titleTranslated?: string | null;
  summary?: string;
  summaryTranslated?: string | null;
  tagsTranslated?: string[] | null;
  license?: string;
  coverUrl?: string;
  designCreator?: { name?: string };
  categories?: Array<{ name?: string }>;
  tags?: string[];
  designExtension?: {
    real_pictures?: Array<{ url?: string }>;
    design_pictures?: Array<{ url?: string }>;
  };
  instances?: Array<{
    title?: string;
    summary?: string;
    weight?: number;
    prediction?: number;
    needAms?: boolean;
    instanceFilaments?: Array<{ type?: string }>;
    extention?: { modelInfo?: { compatibility?: { devProductName?: string; nozzleDiameter?: number } } };
  }>;
}

function hours(seconds: number): string {
  const total = Math.round(seconds / 60);
  return total >= 60 ? `${Math.floor(total / 60)} h ${total % 60 ? `${total % 60} min` : ""}`.trim() : `${total} min`;
}

/** MakerWorld's design, from the Next.js data the page ships with. */
function readMakerWorld(html: string): PageFacts | null {
  const raw = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html)?.[1];
  if (!raw) return null;
  let design: MakerWorldDesign | undefined;
  try {
    design = (JSON.parse(raw) as { props?: { pageProps?: { design?: MakerWorldDesign } } }).props?.pageProps?.design;
  } catch {
    return null;
  }
  return design ? readDesign(design) : null;
}

/**
 * MakerWorld's design as its public API answers it (`/api/v1/design-service/design/<id>`): the same object the page
 * ships with, in the designer's language with English translations beside it. The API answers where the page is
 * behind a bot challenge, so it is how a Worker reads a model the page won't show it. Null for anything else.
 */
export function extractMakerWorldDesign(json: unknown, id?: string): PageFacts | null {
  if (!json || typeof json !== "object") return null;
  const design = json as MakerWorldDesign & { id?: unknown };
  // The answer must be the design asked for, not an error object or another model.
  if (id !== undefined && String(design.id) !== id) return null;
  const facts = readDesign({
    ...design,
    title: design.titleTranslated || design.title,
    summary: design.summaryTranslated || design.summary,
    tags: design.tagsTranslated?.length ? design.tagsTranslated : design.tags,
  });
  return facts?.title && !isSiteTitle(facts.title) ? facts : null;
}

function readDesign(design: MakerWorldDesign): PageFacts | null {
  if (!design.title) return null;
  const pictures = design.designExtension;
  const profiles = (design.instances ?? []).slice(0, 4).map((instance) => {
    const materials = unique((instance.instanceFilaments ?? []).map((filament) => filament.type ?? "").filter(Boolean));
    const compatibility = instance.extention?.modelInfo?.compatibility;
    return [
      instance.title && `Profile "${instance.title}"`,
      materials.length ? `material ${materials.join(", ")}` : null,
      instance.weight ? `${instance.weight} g of filament` : null,
      instance.prediction ? `about ${hours(instance.prediction)}` : null,
      instance.needAms ? "needs an AMS" : null,
      compatibility?.devProductName ? `sliced for ${compatibility.devProductName}` : null,
      compatibility?.nozzleDiameter ? `${compatibility.nozzleDiameter} mm nozzle` : null,
      instance.summary ? `note: ${plainText(instance.summary, 300).replace(/\s+/g, " ")}` : null,
    ]
      .filter(Boolean)
      .join("; ");
  });
  const description = [
    plainText(design.summary ?? "", 2500),
    design.categories?.length ? `Category: ${design.categories.map((c) => c.name).join(", ")}` : "",
    design.tags?.length ? `Tags: ${design.tags.slice(0, 8).join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return {
    title: clean(design.title),
    designer: clean(design.designCreator?.name, 120),
    license: clean(design.license, 120),
    // Real photos first: renders are PNGs, which a Worker can't store.
    imageUrls: unique(
      [
        ...(pictures?.real_pictures ?? []).map((p) => p.url),
        ...(pictures?.design_pictures ?? []).map((p) => p.url),
        design.coverUrl,
      ].filter((url): url is string => !!url),
    ),
    description,
    profiles,
  };
}

/**
 * The GraphQL query for a Printables model, as Printables' own web app asks its public API
 * (`https://api.printables.com/graphql/`, no sign-in): everything a draft reads, nothing about the viewer.
 */
export const PRINTABLES_QUERY =
  "query Print($id: ID!) { print(id: $id) { id name summary description tags { name } category { path { name } } " +
  "user { publicUsername } license { name abbreviation } images { filePath } printer { name } materials { name } " +
  "nozzleDiameters layerHeights weight printDuration } }";

/** The API's address. It answers POST with a JSON body, and GET with the query and variables in the address. */
export const PRINTABLES_API = "https://api.printables.com/graphql/";

/**
 * The fields the GET address asks for: what a draft can't do without. Anthropic's web fetch refuses an address over
 * 250 characters (`url_too_long`), so the address carries no settings beyond the materials and weight, no tags.
 */
const PRINTABLES_SHORT_FIELDS =
  "name,summary,description,user{publicUsername},license{abbreviation},images{filePath},materials{name},weight";

/** The longest address Anthropic's web fetch takes. */
export const WEB_FETCH_MAX_URL = 250;

/**
 * The model as one GET address, for Claude's web fetch when the Worker is throttled (it only GETs, and only up to
 * 250 characters): `https://api.printables.com/graphql/?query=%7Bprint(id:1577248)%7Bname,…%7D%7D`, about 190
 * characters. GraphQL needs no quotes round a number and takes commas as spaces; only the braces are escaped, since
 * Printables reads `(`, `:` and `,` as they are.
 */
export const printablesApiUrl = (id: string) =>
  `${PRINTABLES_API}?query=${`{print(id:${id}){${PRINTABLES_SHORT_FIELDS}}}`.replace(/[{}]/g, (brace) =>
    brace === "{" ? "%7B" : "%7D",
  )}`;

/** The model number a Printables API address asks for (`print(id:1577248)`, escaped or not), or null. */
export function printablesApiId(url: string): string | null {
  if (!URL.canParse(url) || new URL(url).hostname !== "api.printables.com") return null;
  let text = url;
  try {
    text = decodeURIComponent(url.replace(/\+/g, " "));
  } catch {
    // A stray % stays as it is.
  }
  return /print\(\s*id\s*:\s*"?(\d{1,12})"?\s*\)/.exec(text)?.[1] ?? null;
}

/** A Printables model's number, from any address of its page (`/model/1577248-carrying-handle`, `/de/model/…`). */
export function printablesId(link: string): string | null {
  if (!URL.canParse(link)) return null;
  const url = new URL(link);
  if (!/(^|\.)printables\.com$/i.test(url.hostname)) return null;
  return /^\/(?:[a-z]{2}\/)?model\/(\d{1,12})(?:[-/]|$)/i.exec(url.pathname)?.[1] ?? null;
}

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
  if (!printablesId(link)) return null;
  const slug = /\/model\/\d{1,12}-([^/?#]+)/i.exec(new URL(link).pathname)?.[1];
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
    const shown =
      BRAND_WORDS[word.toLowerCase()] ?? (index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word);
    const next = title ? `${title} ${shown}` : shown;
    if (next.length > SLUG_TITLE_MAX) break;
    title = next;
  }
  return title || null;
}

interface PrintablesPrint {
  id?: unknown;
  name?: string | null;
  summary?: string | null;
  description?: string | null;
  tags?: Array<{ name?: string | null } | null> | null;
  category?: { path?: Array<{ name?: string | null } | null> | null } | null;
  user?: { publicUsername?: string | null } | null;
  license?: { name?: string | null; abbreviation?: string | null } | null;
  images?: Array<{ filePath?: string | null } | null> | null;
  printer?: { name?: string | null } | null;
  materials?: Array<{ name?: string | null } | null> | null;
  nozzleDiameters?: string[] | null;
  layerHeights?: string[] | null;
  /** Grams, as a string ("29.00"). */
  weight?: string | number | null;
  /** Hours, as a string ("2.46"). */
  printDuration?: string | number | null;
}

/**
 * What Printables' API answered for one model: its facts, `"missing"` when the API says there is no such model
 * (`{"data":{"print":null}}`, also what a removed or private one gives), or null when the answer isn't one of
 * those (an error, another model, not the API's shape).
 */
export function extractPrintablesPrint(json: unknown, id: string): PageFacts | "missing" | null {
  if (!json || typeof json !== "object") return null;
  const answer = json as { data?: { print?: PrintablesPrint | null } | null; errors?: unknown[] };
  if (answer.errors?.length || !answer.data || !("print" in answer.data)) return null;
  const print = answer.data.print;
  if (print === null) return "missing";
  // The short GET address doesn't ask for the id (its caller checks the address); when it's there, it must match.
  if (!print || typeof print !== "object" || (print.id !== undefined && String(print.id) !== id)) return null;
  const title = clean(print.name);
  if (!title || isSiteTitle(title)) return null;
  const names = (list: Array<{ name?: string | null } | null> | null | undefined) =>
    unique((list ?? []).map((entry) => entry?.name?.trim() ?? "").filter(Boolean));
  const abbreviation = print.license?.abbreviation?.trim();
  // "CC-BY-NC-SA" reads as the licence is usually written; the full name has long dashes and double spaces.
  const license = abbreviation ? abbreviation.replace(/^CC-/i, "CC ") : clean(print.license?.name, 120);
  const number = (value: unknown) => (value === null || value === undefined ? Number.NaN : Number(value));
  const grams = number(print.weight);
  const hoursTaken = number(print.printDuration);
  const materials = names(print.materials);
  const profile = [
    materials.length ? `material ${materials.join(", ")}` : null,
    grams > 0 ? `${Math.round(grams)} g of filament` : null,
    hoursTaken > 0 ? `about ${hours(hoursTaken * 3600)}` : null,
    print.layerHeights?.length ? `layer heights ${print.layerHeights.map(Number).join(", ")} mm` : null,
    print.nozzleDiameters?.length ? `${print.nozzleDiameters.map(Number).join(", ")} mm nozzle` : null,
    print.printer?.name ? `printed on ${print.printer.name.trim()}` : null,
  ]
    .filter(Boolean)
    .join("; ");
  const category = names(print.category?.path);
  const tags = names(print.tags);
  const description = [
    plainText(print.summary ?? "", 500),
    plainText(print.description ?? "", 2500),
    category.length ? `Category: ${category.join(" / ")}` : "",
    tags.length ? `Tags: ${tags.slice(0, 8).join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return {
    title,
    designer: clean(print.user?.publicUsername, 120),
    license,
    // The originals, as Printables keeps them (pictureRequestUrl asks its image host for a WebP of them).
    imageUrls: unique(
      (print.images ?? [])
        .map((image) => image?.filePath?.replace(/^\/+/, ""))
        .filter((path): path is string => !!path && path.startsWith("media/"))
        .map((path) => `https://media.printables.com/${path}`),
    ),
    description,
    profiles: profile ? [profile] : [],
  };
}

/**
 * A title that names the site, not a model: what a site's soft "not found" page says (Thingiverse answers a thing
 * that doesn't exist with 200 and "Thingiverse - The community for Open Hardware"), or a challenge or error page.
 */
export function isSiteTitle(title: string): boolean {
  const text = title.replace(/\s+/g, " ").trim();
  return (
    /^(thingiverse|makerworld|printables)(\.com)?(\s*[-|:–—]\s.*)?$/i.test(text) ||
    /^(just a moment|attention required|access denied|page not found|not found)\b/i.test(text) ||
    /^(error|404|403)(\s+\d{3})?(\s*[-|:–—]\s.*|\s+not found.*)?$/i.test(text)
  );
}

/**
 * The facts a model page states, or null when it isn't one: nothing to draft from, or a page that doesn't name a
 * model (a soft "not found", a challenge), however much else it says.
 */
export function extractModelPage(site: ModelSiteId, html: string): PageFacts | null {
  const specific = site === "makerworld" ? readMakerWorld(html) : null;
  const facts = specific ?? readGeneric(html);
  const generic = specific ? readGeneric(html) : facts;
  const named = (title: string | null) => (title && !isSiteTitle(title) ? title : null);
  const merged: PageFacts = {
    title: named(facts.title) ?? named(generic.title),
    designer: facts.designer ?? generic.designer,
    license: facts.license ?? generic.license,
    imageUrls: unique([...facts.imageUrls, ...generic.imageUrls]),
    description: facts.description || generic.description,
    profiles: facts.profiles,
  };
  return merged.title ? merged : null;
}
