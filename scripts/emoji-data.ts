/**
 * Writes the emoji picker's data into public/emoji/en/ from the emojibase-data package (a dev dependency), keeping
 * only what the picker reads, so the app serves it from its own origin and never from a CDN.
 * Run it after upgrading emojibase-data: `node scripts/emoji-data.ts`, and commit the two files (decision 0042).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const from = "node_modules/emojibase-data/en";
const to = "public/emoji/en";
mkdirSync(to, { recursive: true });

interface Entry {
  emoji: string;
  label: string;
  tags?: string[];
  group?: number;
  subgroup?: number;
  order?: number;
  version: number;
  skins?: Array<{ emoji: string; tone?: number | number[] }>;
}

const data: Entry[] = JSON.parse(readFileSync(`${from}/data.json`, "utf8"));
const slim = data
  .filter((entry) => entry.group !== undefined)
  .map(({ emoji, label, tags, group, subgroup, order, version, skins }) => ({
    emoji,
    label,
    ...(tags?.length ? { tags } : {}),
    group,
    subgroup,
    order,
    version,
    ...(skins ? { skins: skins.map((skin) => ({ emoji: skin.emoji, tone: skin.tone })) } : {}),
  }));
writeFileSync(`${to}/data.json`, JSON.stringify(slim));
writeFileSync(`${to}/messages.json`, JSON.stringify(JSON.parse(readFileSync(`${from}/messages.json`, "utf8"))));
console.log(`${slim.length} emoji written to ${to}`);
