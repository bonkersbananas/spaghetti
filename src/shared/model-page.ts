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
  summary?: string;
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
  if (!design?.title) return null;
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

/** The facts a page states, or null when there is nothing in it to draft from. */
export function extractModelPage(site: ModelSiteId, html: string): PageFacts | null {
  const specific = site === "makerworld" ? readMakerWorld(html) : null;
  const facts = specific ?? readGeneric(html);
  const generic = specific ? readGeneric(html) : facts;
  const merged: PageFacts = {
    title: facts.title ?? generic.title,
    designer: facts.designer ?? generic.designer,
    license: facts.license ?? generic.license,
    imageUrls: unique([...facts.imageUrls, ...generic.imageUrls]),
    description: facts.description || generic.description,
    profiles: facts.profiles,
  };
  return merged.title || merged.description ? merged : null;
}
