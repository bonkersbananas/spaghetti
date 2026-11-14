/**
 * Colour matching: the colours a model brings, simplified to as many as the printer takes, and each
 * matched to the Pantry spool that looks nearest (or a stand-in, when nothing does). Pure: the 3MF reader says the
 * colours (model3mf.ts), the slice worker prints with the plan, the Filament section shows it.
 */
import { materialKey, type SpoolLike, spoolColors } from "../spools.ts";
import { filamentOfSpool, slicingSpools } from "./pantry.ts";
import type { SlicingFilament } from "./settings.ts";

/**
 * Filaments a model's colours are simplified to. The X2D's AMS holds eight, but OrcaSlicer's engine says a prime tower
 * for seven or more "is partially outside the printable area" wherever it is put (tried at the back right and the front
 * left), so six is what a plate in several filaments slices with.
 */
export const MAX_COLOURS = 6;
/** Two colours this near (OKLab, 1 is black to white) are one: a dye lot apart, not another colour. */
export const MERGE_BELOW = 0.045;
/** A spool this near a colour passes for it; further and the colour is "not in the Pantry yet". */
export const CLOSE_ENOUGH = 0.13;

/** A colour as a model gives it: its "#rrggbb", the file's name for it and how much of the model it covers (mm²). */
export interface ColourUse {
  hex: string;
  name?: string;
  area: number;
}

/** What the model's colours come to, simplified: each group is one colour to print. */
export interface ColourGroup {
  /** The heaviest member's colour (lowercase "#rrggbb"): the group's key, and what the stand-in is made in. */
  hex: string;
  name?: string;
  /** The colours merged into it, the group's own first. */
  members: { hex: string; name?: string }[];
  /** mm² of surface. */
  area: number;
}

/** Linear sRGB → OKLab (Björn Ottosson's), as [L, a, b]. */
export function oklab(hex: string): [number, number, number] {
  const channel = (at: number) => {
    const c = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const r = channel(1);
  const g = channel(3);
  const b = channel(5);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** How far apart two colours look: the distance in OKLab (0 the same, about 1 black against white). */
export function colourDistance(a: string, b: string): number {
  const [l1, a1, b1] = oklab(a);
  const [l2, a2, b2] = oklab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

/**
 * The model's colours as the colours to print: the same colour used by several parts is one, colours nearer than
 * `MERGE_BELOW` merge, and when there are still more than `max` the nearest pair merges again until they fit. A group
 * keeps the colour and name of its heaviest member. Heaviest first.
 */
export function simplifyColours(uses: readonly ColourUse[], max = MAX_COLOURS): ColourGroup[] {
  const groups: ColourGroup[] = [];
  for (const use of uses) {
    const same = groups.find((group) => group.hex === use.hex);
    if (same) {
      same.area += use.area;
      if (!same.name && use.name) same.name = use.name;
      const member = same.members[0];
      if (member && !member.name && use.name) member.name = use.name;
    } else {
      groups.push({
        hex: use.hex,
        ...(use.name ? { name: use.name } : {}),
        members: [{ hex: use.hex, ...(use.name ? { name: use.name } : {}) }],
        area: use.area,
      });
    }
  }
  for (;;) {
    let best: [number, number, number] | null = null;
    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        const d = colourDistance((groups[i] as ColourGroup).hex, (groups[j] as ColourGroup).hex);
        if (!best || d < best[0]) best = [d, i, j];
      }
    }
    if (!best || (best[0] >= MERGE_BELOW && groups.length <= max)) break;
    const [, i, j] = best;
    const a = groups[i] as ColourGroup;
    const b = groups[j] as ColourGroup;
    const [heavy, light] = a.area >= b.area ? [a, b] : [b, a];
    heavy.members.push(...light.members);
    heavy.area += light.area;
    groups.splice(light === a ? i : j, 1);
  }
  return groups.sort((a, b) => b.area - a.area);
}

/** What prints a colour: a filament, and whether it is one the Pantry has. */
export interface ColourMatch {
  filament: SlicingFilament;
  /** False for a stand-in made in the colour: "not in the Pantry yet". */
  inPantry: boolean;
}

/**
 * The Pantry spool that looks nearest a colour, if any is close enough; else a stand-in in the colour (PLA, or the
 * `material` a project's filament is). A multi-colour spool is never matched, only offered (the rows list every
 * spool); a spool of another material than the one asked for (a project's PETG) has to look better to win.
 */
export function matchColour(
  group: Pick<ColourGroup, "hex" | "name">,
  spools: readonly SpoolLike[],
  material?: string,
): ColourMatch {
  let best: { spool: SpoolLike; score: number; distance: number } | null = null;
  for (const spool of slicingSpools(spools)) {
    if (!spool.colorHex || !/^#[0-9a-f]{6}$/i.test(spool.colorHex) || spoolColors(spool).length > 1) continue;
    const distance = colourDistance(group.hex, spool.colorHex.toLowerCase());
    // The asked material over others when two look alike (PLA by default), and a loaded spool over one on the shelf
    // (slicingSpools' order).
    const wanted = material ?? "PLA";
    const score = distance + (materialKey(spool.material) === materialKey(wanted) ? 0 : material ? 0.15 : 0.02);
    if (!best || score < best.score - 1e-9) best = { spool, score, distance };
  }
  if (best && best.distance <= CLOSE_ENOUGH) return { filament: filamentOfSpool(best.spool), inPantry: true };
  return {
    filament: {
      material: material ?? "PLA",
      colorHex: group.hex,
      ...(group.name ? { colorName: group.name } : {}),
    },
    inPantry: false,
  };
}

/**
 * What someone chose to print one of the model's colours in: the group's `from` colour (or, for a project's own
 * filament, `f1`, `f2`…: its number), and the filament.
 */
export interface ColourChoice {
  from: string;
  filament: SlicingFilament;
}

/** How a model's colours print: one row a group, and which filament each of the plate's filaments is. */
export interface ColourPlan {
  groups: (ColourGroup & ColourMatch & { chosen: boolean })[];
  /** The plate's filaments, filament 1 first: the groups' distinct filaments, the heaviest group's first. */
  filaments: SlicingFilament[];
  /** For each colour of the model (any member's hex), its filament's index in `filaments`. */
  filamentOf: Map<string, number>;
}

const sameFilament = (a: SlicingFilament, b: SlicingFilament) =>
  a.spoolId || b.spoolId ? a.spoolId === b.spoolId : a.material === b.material && a.colorHex === b.colorHex;

/** Simplifies, matches and gathers the filaments. `choices` win over the match, by the group they were made for. */
export function planColours(
  uses: readonly ColourUse[],
  spools: readonly SpoolLike[],
  choices: readonly ColourChoice[] = [],
  max = MAX_COLOURS,
): ColourPlan {
  const filaments: SlicingFilament[] = [];
  const filamentOf = new Map<string, number>();
  const groups = simplifyColours(uses, max).map((group) => {
    const choice = choices.find((c) => c.from === group.hex);
    const match: ColourMatch = choice
      ? { filament: choice.filament, inPantry: !!choice.filament.spoolId }
      : matchColour(group, spools);
    let index = filaments.findIndex((filament) => sameFilament(filament, match.filament));
    if (index < 0) index = filaments.push(match.filament) - 1;
    for (const member of group.members) filamentOf.set(member.hex, index);
    return { ...group, ...match, chosen: !!choice };
  });
  return { groups, filaments, filamentOf };
}

/** A project's filament as its settings list it: its number (from 1), its colour (when it says one) and type. */
export interface ProjectFilament {
  slot: number;
  hex?: string;
  material: string;
}

/** The key of a choice for a project's filament. */
export const slotKey = (slot: number) => `f${slot}`;

/**
 * Each of a project's filaments matched to the nearest Pantry spool (of its own material first), a choice winning,
 * and what the plate prints with: the filaments in the project's order, so every object, part and painted triangle
 * keeps its filament number. Filaments the project lists but no object uses keep their own.
 */
export function planProject(
  filaments: readonly ProjectFilament[],
  used: ReadonlySet<number>,
  spools: readonly SpoolLike[],
  choices: readonly ColourChoice[] = [],
) {
  const out: SlicingFilament[] = [];
  const rows: { slot: number; hex?: string; material: string; match: ColourMatch; chosen: boolean }[] = [];
  for (const project of filaments) {
    const own: SlicingFilament = { material: project.material, ...(project.hex ? { colorHex: project.hex } : {}) };
    if (!used.has(project.slot)) {
      out[project.slot - 1] = own;
      continue;
    }
    const choice = choices.find((c) => c.from === slotKey(project.slot));
    const match: ColourMatch = choice
      ? { filament: choice.filament, inPantry: !!choice.filament.spoolId }
      : project.hex
        ? matchColour({ hex: project.hex }, spools, project.material)
        : { filament: own, inPantry: false };
    out[project.slot - 1] = match.filament;
    rows.push({ ...project, match, chosen: !!choice });
  }
  return { filaments: out, rows };
}
