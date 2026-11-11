/**
 * Design lint (part of `pnpm lint`): UI code uses the design tokens, not
 * ad-hoc values. In src/client (except styles/), it rejects:
 *
 *   - color literals: #hex, rgb(), hsl(), oklch() in components
 *   - arbitrary Tailwind values that bypass tokens: text-[13px], bg-[#fff],
 *     p-[7px], rounded-[10px], shadow-[…], and any [..px] value
 *   - inline style colors and font sizes
 *
 * Arbitrary values that reference a token (var(--sg-…)) or use viewport
 * units for layout (max-h-[92dvh]) are fine. If you need a new value, add a
 * token to src/client/styles/tokens.css and document it in docs/design.md.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { root } from "./lib/wrangler.ts";

const clientDir = join(root, "src/client");
const skip = [join(clientDir, "styles"), join(clientDir, "assets"), join(clientDir, "routeTree.gen.ts")];

const rules: Array<{ pattern: RegExp; message: string }> = [
  { pattern: /(?<![\w&])#[0-9a-fA-F]{3,8}\b(?![\w-]*["'`]?\s*:)/g, message: "color literal: use a color token" },
  { pattern: /\b(?:rgba?|hsla?|oklch|oklab)\(/g, message: "color function: use a color token" },
  {
    pattern:
      /\b(?:text|bg|fill|stroke|border|ring|outline|shadow|from|to|via|decoration|accent|caret)-\[(?!var\(--sg-)[^\]]+\]/g,
    message: "arbitrary color, size or shadow: use a token",
  },
  { pattern: /\b(?:rounded|font|leading|tracking)-\[[^\]]+\]/g, message: "arbitrary type or radius: use a token" },
  { pattern: /-\[[^\]]*\d+(?:\.\d+)?px[^\]]*\]/g, message: "pixel value in an arbitrary class: use the spacing scale" },
  {
    // The build leaves these weights out of every icon (scripts/vite-phosphor-weights.ts): they'd draw nothing.
    pattern: /\bweight=(?:"|\{")(?:thin|duotone)"/g,
    message: "icon weight left out of the build: use regular, light, bold or fill",
  },
  {
    pattern: /style=\{\{[^}]*\b(?:color|background|fontSize|fontFamily|boxShadow)\s*:/g,
    message: "inline style: use tokens via classes",
  },
];

function* files(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (skip.some((s) => path.startsWith(s))) continue;
    if (statSync(path).isDirectory()) yield* files(path);
    else if (/\.(tsx?|css)$/.test(name)) yield path;
  }
}

const problems: string[] = [];
for (const file of files(clientDir)) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, index) => {
    if (line.includes("design-lint-ignore")) return;
    for (const { pattern, message } of rules) {
      for (const match of line.matchAll(pattern)) {
        problems.push(`${relative(root, file)}:${index + 1}  ${match[0]}  ${message}`);
      }
    }
  });
}

if (problems.length) {
  console.error(`✗ Design lint: ${problems.length} ad-hoc value(s)\n${problems.join("\n")}`);
  console.error("\nSee docs/design.md. Add a token instead, or mark a justified line with // design-lint-ignore.");
  process.exit(1);
}
console.log("✓ Design lint: tokens only");
