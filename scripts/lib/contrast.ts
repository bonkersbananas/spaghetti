/**
 * WCAG contrast for the design tokens. Reads src/client/styles/tokens.css, so
 * the numbers in docs/design.md and the test in test/unit/contrast.test.ts
 * always describe the real colors.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { root } from "./wrangler.ts";

export type Rgba = [number, number, number, number];
export type Theme = "light" | "dark";

/** Token name (without --sg-) to its value, for each theme. Dark falls back to light. */
export function readTokens(css = readFileSync(join(root, "src/client/styles/tokens.css"), "utf8")) {
  const block = (selector: string) => {
    const start = css.indexOf(`${selector} {`);
    if (start < 0) throw new Error(`tokens.css has no ${selector} block`);
    const end = css.indexOf("\n}", start);
    const vars = new Map<string, string>();
    for (const match of css.slice(start, end).matchAll(/--sg-([a-z0-9-]+):\s*([^;]+);/g)) {
      vars.set(match[1] as string, (match[2] as string).trim());
    }
    return vars;
  };
  const light = block(":root");
  const dark = new Map([...light, ...block('[data-theme="dark"]')]);
  return { light, dark } satisfies Record<Theme, Map<string, string>>;
}

export function parseColor(value: string): Rgba {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const digits =
      (hex[1] as string).length === 3 ? [...(hex[1] as string)].map((d) => d + d).join("") : (hex[1] as string);
    const n = Number.parseInt(digits, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const rgb = /^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)(?:\s*\/\s*([\d.]+))?\s*\)$/.exec(value);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), rgb[4] === undefined ? 1 : Number(rgb[4])];
  throw new Error(`Can't read the color "${value}"`);
}

/** `top` laid over an opaque `under`. */
export function over(top: Rgba, under: Rgba): Rgba {
  const a = top[3];
  return [0, 1, 2].map((i) => Math.round((top[i] as number) * a + (under[i] as number) * (1 - a))).concat(1) as Rgba;
}

function luminance([r, g, b]: Rgba) {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrast(a: Rgba, b: Rgba) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

export interface Pair {
  /** What it is, for the table: "Body text on paper". */
  label: string;
  fg: string;
  /** A token, a #hex, or "token/alpha" for a translucent layer over `under` (a field's well, a chip). */
  bg: string;
  /** What a translucent bg sits on. */
  under?: string;
  /** 4.5 for text, 3 for large text and the parts of controls people must see. */
  min: 4.5 | 3;
}

/** Every combination of text and surface the app uses. */
export const pairs: Pair[] = [
  { label: "Body text", fg: "ink", bg: "paper", min: 4.5 },
  { label: "Body text on cards", fg: "ink", bg: "cream", min: 4.5 },
  { label: "Body text on sheets", fg: "ink", bg: "lifted", min: 4.5 },
  { label: "A note on a note card", fg: "ink", bg: "note", min: 4.5 },
  { label: "Labels and body copy", fg: "ink-soft", bg: "paper", min: 4.5 },
  { label: "Labels on cards", fg: "ink-soft", bg: "cream", min: 4.5 },
  { label: "Meta and hints", fg: "ink-faint", bg: "paper", min: 4.5 },
  { label: "Meta on cards", fg: "ink-faint", bg: "cream", min: 4.5 },
  { label: "Meta on sheets", fg: "ink-faint", bg: "lifted", min: 4.5 },
  { label: "Meta on the sidebar", fg: "ink-faint", bg: "paper-deep", min: 4.5 },
  { label: "Text typed in a field", fg: "ink", bg: "ink/0.04", under: "cream", min: 4.5 },
  { label: "Placeholder in a field", fg: "ink-faint", bg: "ink/0.04", under: "cream", min: 4.5 },
  { label: "Placeholder in a field on a sheet", fg: "ink-faint", bg: "ink/0.04", under: "lifted", min: 4.5 },
  { label: "Hint in a hovered well on a sheet", fg: "ink-faint", bg: "ink/0.06", under: "lifted", min: 4.5 },
  { label: "Error text", fg: "tomato-ink", bg: "paper", min: 4.5 },
  { label: "Error text on cards", fg: "tomato-ink", bg: "cream", min: 4.5 },
  { label: "Printer check", fg: "semolina-ink", bg: "paper", min: 4.5 },
  { label: "Printer check on cards", fg: "semolina-ink", bg: "cream", min: 4.5 },
  { label: "Printer check on sheets", fg: "semolina-ink", bg: "lifted", min: 4.5 },
  { label: "Active tab label", fg: "tomato-ink", bg: "cream", min: 4.5 },
  { label: "Tomato chip", fg: "tomato-ink", bg: "tomato-soft", min: 4.5 },
  { label: "Basil chip", fg: "basil-ink", bg: "basil-soft", min: 4.5 },
  { label: "Semolina chip", fg: "semolina-ink", bg: "semolina-soft", min: 4.5 },
  { label: "Neutral chip", fg: "ink-soft", bg: "ink/0.06", under: "paper", min: 4.5 },
  { label: "Selected chip", fg: "on-select", bg: "select", min: 4.5 },
  { label: "Search match", fg: "ink", bg: "semolina-soft", min: 4.5 },
  { label: "Primary button", fg: "on-accent", bg: "tomato", min: 4.5 },
  { label: "Primary button, held", fg: "on-accent", bg: "tomato-pressed", min: 4.5 },
  { label: "Held cream chip or card", fg: "ink", bg: "ink/0.08", under: "cream", min: 4.5 },
  { label: "Held selected chip", fg: "on-select", bg: "on-select/0.08", under: "select", min: 4.5 },
  { label: "Held tomato chip", fg: "tomato-ink", bg: "tomato-ink/0.08", under: "tomato-soft", min: 4.5 },
  { label: "Held basil chip", fg: "basil-ink", bg: "basil-ink/0.08", under: "basil-soft", min: 4.5 },
  { label: "Held semolina chip", fg: "semolina-ink", bg: "semolina-ink/0.08", under: "semolina-soft", min: 4.5 },
  { label: "Danger button, held", fg: "on-accent", bg: "tomato-pressed", min: 4.5 },
  { label: "Tab bar icon on its held highlight", fg: "ink-faint", bg: "pressed", min: 3 },
  { label: "Primary button, hovered", fg: "on-accent", bg: "tomato-strong", min: 4.5 },
  { label: "Badge over a white photo", fg: "on-veil", bg: "veil", under: "#ffffff", min: 4.5 },
  { label: "Toast", fg: "toast-fg", bg: "toast", min: 4.5 },
  { label: "Initials on tomato avatar", fg: "on-accent", bg: "person-tomato", min: 4.5 },
  { label: "Initials on basil avatar", fg: "on-accent", bg: "person-basil", min: 4.5 },
  { label: "Initials on semolina avatar", fg: "on-accent", bg: "person-semolina", min: 4.5 },
  { label: "Initials on plum avatar", fg: "on-accent", bg: "person-plum", min: 4.5 },
  { label: "Initials on sea avatar", fg: "on-accent", bg: "person-sea", min: 4.5 },
  { label: "Initials on clay avatar", fg: "on-accent", bg: "person-clay", min: 4.5 },
  { label: "Active icon (tomato) on the sidebar", fg: "tomato", bg: "paper-deep", min: 3 },
  { label: "Basil icon on cards", fg: "basil", bg: "cream", min: 3 },
  { label: "Print progress label", fg: "ink-soft", bg: "cream", min: 4.5 },
  { label: "Print progress label, due", fg: "semolina-ink", bg: "cream", min: 4.5 },
  { label: "Print progress label on paper, due", fg: "semolina-ink", bg: "paper", min: 4.5 },
  { label: "A changed value in the compare sheet", fg: "ink", bg: "semolina-soft/0.7", under: "lifted", min: 4.5 },
  { label: "Same-in-both settings, opened, on a sheet", fg: "ink-soft", bg: "ink/0.03", under: "lifted", min: 4.5 },
  { label: "Column names and labels in the compare sheet", fg: "ink-faint", bg: "lifted", min: 4.5 },
  { label: "A link card's letter tile", fg: "ink-soft", bg: "ink/0.05", under: "cream", min: 4.5 },
  { label: "Attempt count on the outcome strip", fg: "ink-faint", bg: "cream", min: 4.5 },
  { label: "An open tick box on a card", fg: "ink/0.55", bg: "cream", min: 3 },
  { label: "An open tick box on a sheet", fg: "ink/0.55", bg: "lifted", min: 3 },
  { label: "A choice tile's name", fg: "ink-soft", bg: "tile", min: 4.5 },
  { label: "A choice tile's figure", fg: "ink-faint", bg: "tile", min: 4.5 },
  { label: "Body text on what rises from a sheet", fg: "ink", bg: "tile", min: 4.5 },
  { label: "An unpicked chip on a sheet", fg: "ink-soft", bg: "tile", min: 4.5 },
  { label: "Held chip or card on a sheet", fg: "ink", bg: "ink/0.08", under: "tile", min: 4.5 },
  { label: "Meta on a card on a sheet", fg: "ink-faint", bg: "tile", min: 4.5 },
];

export function measure(theme: Theme, pair: Pair, tokens = readTokens()[theme]): number {
  const color = (name: string) => {
    if (name.startsWith("#")) return parseColor(name);
    const [token, alpha] = name.split("/") as [string, string | undefined];
    const value = tokens.get(token);
    if (!value) throw new Error(`No token --sg-${token}`);
    const rgba = parseColor(value);
    return alpha === undefined ? rgba : ([rgba[0], rgba[1], rgba[2], Number(alpha)] as Rgba);
  };
  const under = pair.under ? color(pair.under) : null;
  const bgRaw = color(pair.bg);
  const bg = bgRaw[3] < 1 ? over(bgRaw, under ?? color("paper")) : bgRaw;
  return contrast(over(color(pair.fg), bg), bg);
}

if (import.meta.main) {
  const tokens = readTokens();
  console.log("| Pair | Needs | Light | Dark |\n| --- | --- | --- | --- |");
  for (const pair of pairs) {
    const [l, d] = [measure("light", pair, tokens.light), measure("dark", pair, tokens.dark)];
    const mark = (n: number) => `${n.toFixed(1)}${n < pair.min ? " ✗" : ""}`;
    console.log(`| ${pair.label} | ${pair.min}:1 | ${mark(l)} | ${mark(d)} |`);
  }
}
